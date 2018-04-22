#!/usr/bin/env node

const log = require('yalm');
const Mqtt = require('mqtt');
const config = require('./config.js');
const request = require('request-promise-native');
const fs = require('fs');
const pkg = require('./package.json');

let mqtt;
let mqttConnected = false;
var eventsConnected = false;
var events = [];
var eventsTracker = null;

function eventRemove(category, summary, start, finish) {
  var i = 0;
  while (i < events.length)
    if ((events[i].category === category) && (events[i].summary === summary) && (events[i].start === start) && (events[i].finish === finish))
      events.splice(i, 1);
    else
      i++;
}

function eventAdd(category, summary, start, finish) {
  var ts = new Date().getTime();
  if (finish > ts) {
    var dup = false;
    for (var i = 0; i < events.length; i++)
      if (events[i].category === category)
        if (events[i].summary === summary)
          if (events[i].start === start)
            if (events[i].finish === finish)
              dup = true;
    if (!dup)
      events.push({
        category: category,
        summary: summary,
        start: start,
        finish: finish
      });
  }
}

function eventsRemovePast() {
  var ts = new Date().getTime();
  var i = 0;
  while (i < events.length)
    if (events[i].finish < ts)
      events.splice(i, 1);
    else
      i++;
  eventsSave();
}

function eventsRefreshWaste() {
  const wasteTypes = [
    { type: 'Biotonne', desc: 'Biotonne', color: 'brown', id: 11 },
    { type: 'GelberSack', desc: 'Leicht-Verpackungen', color: 'yellow', id: 9 },
    { type: 'Papiertonne', desc: 'Papiertonne', color: 'blue', id: 12 },
    { type: 'Restmüll', desc: 'Restmüll', color: 'brown', id: 6 }
  ];
  const prerun = 24 * 60 * 60 * 1000;
  const postrun = 10 * 60 * 60 * 1000;
  url = 'http://' + config.city + '.mainort-abfallkalender.de/api/v1/public/calendar?specialDates=true&district=' + config.district;
  for (var i = 0; i < wasteTypes.length; i++)
    url += '&wasteType[]=' + wasteTypes[i].id;
  ical.fromURL(url, {}, (err, data) => {
    if (err)
      console.log('error: ' + err);
    else {
      Object.keys(data).forEach((key) => {
        var val = data[key];
        if (val.type === 'VEVENT') {
          var d = new Date(val.start).getTime();
          var type = val.summary;
          for (var i = 0; i < wasteTypes.length; i++)
            if (type.startsWith(wasteTypes[i].desc)) {
              type = wasteTypes[i].type;
              break;
            }
          eventAdd('waste', type, d - prerun, d + postrun);
        }
      });
      eventsSave();
    }
  });
}

function eventsRefreshHoliday() {
  for (var i = 0; i < 2; i++) {
    var year = new Date().getFullYear() + i;
    var url = 'https://feiertage-api.de/api/?jahr=' + year + '&nur_land=' + config.region;
    request({
      url: url,
      json: true
    }, (err, response, body) => {
      if (err)
        console.log('error: ' + err);
      else {
        Object.keys(body).forEach((key) => {
          var val = body[key];
          var d = new Date(val.datum + 'T00:00:00').getTime();
          addEvent('holiday', key, d, d + 24*60*60*1000);
        });
        eventsSave();
      }
    });
  }
}

function eventsRefreshSchool() {
  var url = 'https://ferien-api.de/api/v1/holidays/' + config.region;
  request({
    url: url,
    json: true
  }, (err, response, body) => {
    if (err)
      console.log('error: ' + err);
    else {
      console.log('body: ' + JSON.stringify(body));
      for (var i = 0; i < body.length; i++) {
        var val = body[i];
        var tss = new Date(val.start).getTime();
        var tsf = new Date(val.end).getTime();
        addEvent('schoolvacation', val.name, tss, tsf);
      }
      eventsSave();
    }
  });
}

function eventsLoad() {
  fs.readFile('/data/events.json', (err, data) => {
    if (err)
      log.error('error reading events file');
    else {
      try {
        events = JSON.parse(data);
        if (events.length == 0)
          eventsRefresh();
      } catch(err) {
      }
      eventsConnect();
    }
  });
}

var eventsSaved = 0;
var eventsChanged = false;

function eventsSave(change = true) {
  if (change)
    eventsChanged = true;
  if (eventsChanged) {
    var ts = new Date().getTime();
    if (ts > eventsSaved + 60 * 1000) {
      eventsChanged = false;
      fs.writeFile('/data/events.json', JSON.stringify(events));
      lastSave = ts;
    }
  }
}

function eventsRefresh() {
  // ToDo : refresh partial only
  eventsRefreshWaste();
  eventsRefreshHoliday();
  eventsRefreshSchool();
}

function eventAddManual() {
  // ToDo
  eventsSave();
}

function start() {
    log.setLevel(config.verbosity);
    log.info(pkg.name + ' ' + pkg.version + ' starting');

    eventsLoad();

    log.info('mqtt trying to connect', config.mqttUrl);

    mqtt = Mqtt.connect(config.mqttUrl, {
        clientId: config.name + '_' + Math.random().toString(16).substr(2, 8),
        will: {topic: config.name + '/connected', payload: '0', retain: (config.mqttRetain)},
        rejectUnauthorized: !config.insecure
    });

    mqtt.on('connect', () => {
        mqttConnected = true;
        log.info('mqtt connected', config.mqttUrl);
        mqtt.publish(config.name + '/connected', eventsConnected ? '2' : '1', {retain: config.mqttRetain});
        log.info('mqtt subscribe', config.name + '/set/#');
        mqtt.subscribe(config.name + '/set/#');
    });

    mqtt.on('close', () => {
        if (mqttConnected) {
            mqttConnected = false;
            log.info('mqtt closed ' + config.mqttUrl);
        }
    });

    mqtt.on('error', err => {
        log.error('mqtt', err.toString());
    });

    mqtt.on('offline', () => {
        log.error('mqtt offline');
    });

    mqtt.on('reconnect', () => {
        log.info('mqtt reconnect');
    });

    mqtt.on('message', (topic, payload) => {
        payload = payload.toString();
        log.debug('mqtt <', topic, payload);

        if (payload.indexOf('{') !== -1) {
            try {
                payload = JSON.parse(payload);
            } catch (err) {
                log.error(err.toString());
            }
        } else if (payload === 'false') {
            payload = false;
        } else if (payload === 'true') {
            payload = true;
        } else if (!isNaN(payload)) {
            payload = parseFloat(payload);
        }
        const [, method, device, type] = topic.split('/');

        switch (method) {
            case 'set':
                switch (type) {
                    case 'refresh':
                        eventsRefresh();
                        break;
                    case 'add':
                        eventsAddManual();
                        break;
                    default:
                        log.error('unknown method', method);
                }
                break;
            default:
                log.error('unknown method', method);
        }
    });
}

function eventsChecker() {
  var dt = new Date().getTime();
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if ((event.start < dt) && (event.finish > dt) && (!(event.triggered))) {
      mqttPublish(config.name + '/status/' + event.category + '/' + event.summary + '/state', JSON.stringify({ val: true, ts: ts, start: event.start, finish: event.finish }), {retain: true});
      event.triggered = true;
    } else if ((event.finish < dt) && (event.triggered)) {
      mqttPublish(config.name + '/status/' + event.category + '/' + event.summary + '/state', JSON.stringify({ val: false, ts: ts, start: event.start, finish: event.finish }), {retain: true});
      event.triggered = false;
    }
  }
  eventsSave(false);
}

function eventsConnect() {
    if (!eventsConnected) {
        eventsConnected = true;
        log.info('events connected');
        mqttPublish(config.name + '/connected', '2', {retain: config.mqttRetain});
        eventsTracker = setInterval(eventsChecker, 5 * 60 * 1000);
    }
}

function eventsDisconnect() {
    if (eventsConnected) {
        eventsConnected = false;
        log.error('events disconnected');
        mqttPublish(config.name + '/connected', '1', {retain: config.mqttRetain});
// ToDo : delete cookies ?
    }
}

function mqttPublish(topic, payload, options) {
    if (!payload) {
        payload = '';
    } else if (typeof payload !== 'string') {
        payload = JSON.stringify(payload);
    }
    log.debug('mqtt >', topic, payload);
    mqtt.publish(topic, payload, options);
}

start();
