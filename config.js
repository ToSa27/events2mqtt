module.exports = require('yargs')
    .env('EVENTS2MQTT')
    .usage('Usage: $0 [options]')
    .describe('v', 'possible values: "error", "warn", "info", "debug"')
    .describe('n', 'instance name. used as connected topic and client id prefix')
    .describe('m', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('c', 'city')
    .describe('d', 'district')
    .describe('r', 'region')
    .describe('h', 'show help')
    .alias({
        h: 'help',
        n: 'name',
        m: 'mqtt-url',
        v: 'verbosity',
        c: 'city',
        d: 'district',
        r: 'region',
    })
    .default({
        m: 'mqtt://localhost',
        n: 'event',
        v: 'info',
        c: 'liederbach-taunus',
        d: 10,
        r: 'HE',
    })
    .version()
    .help('help')
    .argv;
