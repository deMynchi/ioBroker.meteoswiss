"use strict";
/*
 * Created with @iobroker/create-adapter v1.32.0
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = __importStar(require("@iobroker/adapter-core"));
const axios_1 = __importDefault(require("axios"));
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const sqlite_1 = require("sqlite");
const sqlite3_1 = __importDefault(require("sqlite3"));
const STATIC_BASE_URL = 'https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/';
const DYNAMIC_BASE_URL = 'https://app-prod-ws.meteoswiss-app.ch/v1/';
const USER_AGENT = 'Android-30 ch.admin.meteoswiss-2410';
const ICON_URL_FORMAT = 'https://cdn.jsdelivr.net/npm/meteo-icons/icons/weathericon_%s.png';
function toDateStr(timestamp) {
    return new Date(timestamp).toISOString();
}
function toIconUrl(icon) {
    if (icon === undefined) {
        return undefined;
    }
    let num = icon.toString();
    while (num.length < 3) {
        num = '0' + num;
    }
    return ICON_URL_FORMAT.replace('%s', num);
}
class MeteoSwiss extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'meteoswiss',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);
        this.axios = axios_1.default.create({
            headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip',
                'Accept-Language': this.config.language || 'de',
                'User-Agent': USER_AGENT,
            },
        });
        await this.loadDatabase();
        await this.createObjects();
        /*await this.setObjectNotExistsAsync('testVariable', {
            type: 'state',
            common: {
                name: 'testVariable',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: true,
            },
            native: {},
        });

        await this.setStateAsync('testVariable', { val: true, ack: true });*/
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        this.unload().finally(callback);
    }
    async unload() {
        await this.database.close();
    }
    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     */
    onMessage(obj) {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'send') {
                // e.g. send email or pushover or whatever
                this.log.info('send command');
                // Send response in callback if required
                if (obj.callback)
                    this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
            }
        }
    }
    async loadDatabase() {
        const baseDir = utils.getAbsoluteInstanceDataDir(this);
        await fs_extra_1.ensureDir(baseDir);
        const filename = path_1.default.join(baseDir, 'db.sqlite');
        try {
            await this.openDatabase(filename);
            // TODO: check version
            const info = await this.downloadJson('dbinfo.json', true);
            const metadata = await this.database.get('SELECT * FROM metadata');
            if (metadata && info.dbVersion.toString() === metadata.version) {
                return;
            }
            this.log.debug(`Outdated local database: ${metadata === null || metadata === void 0 ? void 0 : metadata.version} <> ${info.dbVersion}`);
        }
        catch (error) {
            this.log.debug(`Couldn't open local database ${filename}: ${error}`);
        }
        // download the database
        await this.downloadFile('db.sqlite', filename);
        await this.openDatabase(filename);
    }
    async openDatabase(filename) {
        if (this.database) {
            await this.database.close();
        }
        this.database = await sqlite_1.open({
            filename: filename,
            driver: sqlite3_1.default.cached.Database,
        });
    }
    async createObjects() {
        for (let i = this.config.zips.length - 1; i >= 0; i--) {
            const zip = this.config.zips[i];
            try {
                this.log.debug(`Creating objects for ${zip}`);
                const plz = await this.database.get('SELECT * FROM plz WHERE plz_pk = ?', [zip]);
                if (!plz) {
                    throw new Error(`Couldn't find PLZ ${zip}`);
                }
                await this.ensureDevice(zip.toString(), plz.primary_name);
            }
            catch (error) {
                this.log.warn(`Couldn't create objects for ${zip}, not polling its values`);
                this.config.zips.splice(i, 1);
            }
        }
        for (let i = this.config.stations.length - 1; i >= 0; i--) {
            const station = this.config.stations[i];
            try {
                this.log.debug(`Creating objects for ${station}`);
                const wetterstation = await this.database.get('SELECT * FROM wetterstation WHERE station_pk = ?', [station]);
                if (!wetterstation) {
                    throw new Error(`Couldn't find station ${station}`);
                }
                await this.ensureDevice(station, `Station ${wetterstation.name}`);
            }
            catch (error) {
                this.log.warn(`Couldn't create objects for ${station}, not polling its values`);
                this.config.stations.splice(i, 1);
            }
        }
        await this.updateStates(true);
    }
    async updateStates(firstRun) {
        for (let i = 0; i < this.config.zips.length; i++) {
            const zip = this.config.zips[i];
            await this.updateZip(zip, firstRun);
        }
        for (let i = 0; i < this.config.stations.length; i++) {
            const station = this.config.stations[i];
            await this.updateStation(station, firstRun);
        }
    }
    async updateZip(zip, firstRun) {
        this.log.debug(`Updating ${zip}`);
        const detail = await this.downloadJson(`plzDetail?plz=${zip}`, false);
        // currentWeather
        if (firstRun) {
            await this.ensureChannel(`${zip}.currentWeather`, 'Current Weather');
            await this.ensureState(`${zip}.currentWeather.time`, 'Time', 'string', 'date');
            await this.ensureState(`${zip}.currentWeather.icon`, 'Icon', 'number', 'value');
            await this.ensureState(`${zip}.currentWeather.iconUrl`, 'Icon URL', 'string', 'text.url');
            await this.ensureState(`${zip}.currentWeather.temperature`, 'Temperature', 'number', 'value.temperature', '°C');
        }
        await this.updateValue(`${zip}.currentWeather.time`, toDateStr(detail.currentWeather.time));
        await this.updateValue(`${zip}.currentWeather.icon`, detail.currentWeather.icon);
        await this.updateValue(`${zip}.currentWeather.iconUrl`, toIconUrl(detail.currentWeather.icon));
        await this.updateValue(`${zip}.currentWeather.temperature`, detail.currentWeather.temperature);
        // forecast (6 days per day)
        for (let day = 0; day < 6; day++) {
            const channel = `${zip}.forecast-${day}`;
            if (firstRun) {
                await this.ensureChannel(channel, 'Forecast');
                await this.ensureState(`${channel}.date`, 'Date', 'string', 'text');
                await this.ensureState(`${channel}.icon`, 'Icon', 'number', 'value');
                await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                await this.ensureState(`${channel}.temperatureMax`, 'Temperature Max', 'number', 'value.temperature', '°C');
                await this.ensureState(`${channel}.temperatureMin`, 'Temperature Min', 'number', 'value.temperature', '°C');
                await this.ensureState(`${channel}.precipitation`, 'Precipitation', 'number', 'value', 'mm');
            }
            const forecast = detail.forecast[day];
            await this.updateValue(`${channel}.date`, forecast === null || forecast === void 0 ? void 0 : forecast.dayDate);
            await this.updateValue(`${channel}.icon`, forecast === null || forecast === void 0 ? void 0 : forecast.iconDay);
            await this.updateValue(`${channel}.iconUrl`, toIconUrl(forecast === null || forecast === void 0 ? void 0 : forecast.iconDay));
            await this.updateValue(`${channel}.temperatureMax`, forecast === null || forecast === void 0 ? void 0 : forecast.temperatureMax);
            await this.updateValue(`${channel}.temperatureMin`, forecast === null || forecast === void 0 ? void 0 : forecast.temperatureMin);
            await this.updateValue(`${channel}.precipitation`, forecast === null || forecast === void 0 ? void 0 : forecast.precipitation);
        }
        // 3 hour slots
        let precipitationIndex10m = 0;
        let precipitationIndex1h = 0;
        for (let day = 0; day < 6; day++) {
            for (let hour = 0; hour < 24; hour += 3) {
                const index1h = day * 24 + hour;
                const index3h = index1h / 3;
                const h = hour > 9 ? hour.toString() : '0' + hour;
                const channel = `${zip}.day-${day}-hour-${h}`;
                if (firstRun) {
                    const dayName = day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : `Today +${day}`;
                    await this.ensureChannel(channel, `${dayName} @ ${h}:00`);
                    await this.ensureState(`${channel}.time`, 'Time', 'string', 'date');
                    await this.ensureState(`${channel}.icon`, 'Icon', 'number', 'value');
                    await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                    await this.ensureState(`${channel}.windDirection`, 'Wind Direction', 'number', 'value', '°');
                    await this.ensureState(`${channel}.windSpeed`, 'Wind Speed', 'number', 'value.speed', 'km/h');
                    await this.ensureState(`${channel}.temperatureMin`, 'Temperature Min', 'number', 'value.temperature', '°C');
                    await this.ensureState(`${channel}.temperatureMax`, 'Temperature Max', 'number', 'value.temperature', '°C');
                    await this.ensureState(`${channel}.temperatureMean`, 'Temperature Mean', 'number', 'value.temperature', '°C');
                    await this.ensureState(`${channel}.precipitation`, 'Precipitation', 'number', 'value', 'mm');
                }
                const offset = (day * 24 + hour) * 3600 * 1000;
                const now = detail.graph.start + offset;
                await this.updateValue(`${channel}.time`, toDateStr(now));
                const icon = detail.graph.weatherIcon3h[index3h];
                await this.updateValue(`${channel}.icon`, icon);
                await this.updateValue(`${channel}.iconUrl`, toIconUrl(icon));
                await this.updateValue(`${channel}.windDirection`, detail.graph.windDirection3h[index3h]);
                await this.updateValue(`${channel}.windSpeed`, detail.graph.windSpeed3h[index3h]);
                await this.updateValue(`${channel}.temperatureMin`, Math.min(...detail.graph.temperatureMin1h.slice(index1h, index1h + 3)));
                await this.updateValue(`${channel}.temperatureMax`, Math.max(...detail.graph.temperatureMax1h.slice(index1h, index1h + 3)));
                await this.updateValue(`${channel}.temperatureMean`, detail.graph.temperatureMean1h.slice(index1h, index1h + 3).reduce((a, b) => a + b) / 3);
                let precipitationSum = 0;
                for (let p = 0; p < 18; p++) {
                    // 18 = 3h * 6 "10-minute-intervals"
                    if (now + p * 10 * 60 * 1000 < detail.graph.startLowResolution) {
                        precipitationSum += detail.graph.precipitation10m[precipitationIndex10m];
                        precipitationIndex10m++;
                    }
                    else {
                        precipitationSum += detail.graph.precipitation1h[precipitationIndex1h] * 6;
                        precipitationIndex1h++;
                        p += 5;
                    }
                }
                await this.updateValue(`${channel}.precipitation`, (precipitationSum / 18) * 3);
            }
        }
    }
    async updateStation(station, firstRun) {
        this.log.debug(`Updating ${station}`);
    }
    async downloadJson(filename, isStaticResource) {
        const url = `${isStaticResource ? STATIC_BASE_URL : DYNAMIC_BASE_URL}${filename}`;
        this.log.debug(`Downloading ${url}`);
        const response = await this.axios.get(url);
        this.log.debug(`Received ${JSON.stringify(response.data)}`);
        return response.data;
    }
    async downloadFile(srcUrl, destPath) {
        this.log.debug(`Downloading ${STATIC_BASE_URL}${srcUrl}`);
        const writer = fs_extra_1.createWriteStream(destPath);
        const response = await this.axios.get(srcUrl, {
            responseType: 'stream',
        });
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
    async ensureDevice(id, name) {
        await this.setObjectNotExistsAsync(id, {
            type: 'device',
            common: {
                name,
            },
            native: {},
        });
    }
    async ensureChannel(id, name) {
        await this.setObjectNotExistsAsync(id, {
            type: 'channel',
            common: {
                name,
            },
            native: {},
        });
    }
    async ensureState(id, name, type, role, unit) {
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name,
                type,
                role,
                unit,
                read: true,
                write: false,
            },
            native: {},
        });
    }
    async updateValue(id, value) {
        if (value === undefined) {
            value = null;
        }
        await this.setStateAsync(id, value, true);
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new MeteoSwiss(options);
}
else {
    // otherwise start the instance directly
    (() => new MeteoSwiss())();
}
