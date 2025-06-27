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
const push_receiver_1 = require("push-receiver");
const sqlite_1 = require("sqlite");
const sqlite3_1 = __importDefault(require("sqlite3"));
const STATIC_BASE_URL = 'https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/';
const DYNAMIC_BASE_URL = 'https://app-prod-ws.meteoswiss-app.ch/v3/';
const USER_AGENT = 'Android-30 ch.admin.meteoswiss-3420';
const GCM_SENDER_ID = '678360867444';
const WEATHER_ICON_URL_FORMAT = 'https://cdn.jsdelivr.net/npm/meteo-icons/icons/weathericon_%s.png';
const WARNING_ICON_URL_FORMAT = 'https://cdn.jsdelivr.net/npm/meteo-icons/icons/bulletinwebicon_type%s_level%s.png';
const STATE_ID_GCM = 'info.gcm';
const STATE_ID_GCM_PERSISTENCE = 'info.gcm-ids';
const WARNINGS = [
    {
        id: 0,
        name: 'Wind',
        minimumLevel: 2,
    },
    {
        id: 1,
        name: 'Thunderstorms',
        minimumLevel: 3,
    },
    {
        id: 2,
        name: 'Rain',
        minimumLevel: 2,
    },
    {
        id: 3,
        name: 'Snow',
        minimumLevel: 2,
    },
    {
        id: 4,
        name: 'Slippery Roads',
        minimumLevel: 2,
    },
    {
        id: 5,
        name: 'Frost',
        minimumLevel: 2,
    },
    {
        id: 7,
        name: 'Heat Waves',
        minimumLevel: 3,
    },
    {
        id: 8,
        name: 'Avalanches',
        minimumLevel: 2,
    },
    {
        id: 9,
        name: 'Earthquakes',
    },
    {
        id: 10,
        name: 'Forest Fire',
        minimumLevel: 2,
    },
    {
        id: 11,
        name: 'Flood',
        minimumLevel: 2,
    },
    {
        id: 12,
        name: 'Drought',
        minimumLevel: 2,
    },
];
function toDateStr(timestamp) {
    return timestamp ? new Date(timestamp).toISOString() : undefined;
}
function toNumber(value) {
    return value === 32767 ? undefined : value;
}
function parseNumber(value) {
    return value === undefined ? undefined : parseInt(value);
}
function getDayName(offset) {
    return offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `Today +${offset}`;
}
function toWeatherIconUrl(icon) {
    if (icon === undefined) {
        return undefined;
    }
    let num = icon.toString();
    while (num.length < 3) {
        num = '0' + num;
    }
    return WEATHER_ICON_URL_FORMAT.replace('%s', num);
}
/**
 * Converts minutes to milliseconds for better readability.
 *
 * @param minutes The number of minutes-
 * @returns The total number of milliseconds.
 */
function minutes(minutes) {
    return minutes * 60 * 1000;
}
class MeteoSwiss extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'meteoswiss',
        });
        this.persistentIds = [];
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
        await this.ensureDatabase();
        // Currently FCM is no longer supported by push-receiver:
        // https://github.com/MatthieuLemoine/push-receiver/issues/68
        // And we don't have all information required by https://aracna.dariosechi.it/fcm/get-started/
        // await this.ensureRegistration();
        await this.createObjects();
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        this.unload().finally(callback);
    }
    async unload() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        await this.closeDatabase();
    }
    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     */
    onMessage(msg) {
        // this.log.info('onMessage() :' + JSON.stringify(msg));
        if (typeof msg === 'object' &&
            msg.command === 'getData' &&
            msg.callback &&
            msg.from &&
            msg.from.startsWith('system.adapter.admin')) {
            this.handleGetDataMessage()
                .then((response) => this.sendTo(msg.from, msg.command, response, msg.callback))
                .catch((e) => {
                this.log.warn(`Couldn't handle getData message: ${e}`);
                this.sendTo(msg.from, msg.command, { error: e || 'No data' }, msg.callback);
            });
        }
    }
    async handleGetDataMessage() {
        await this.ensureDatabase();
        const plzs = await this.database.all('SELECT plz_pk, primary_name FROM plz');
        const weatherstations = await this.database.all('SELECT station_pk, name FROM wetterstation');
        return {
            data: {
                zips: plzs.reduce(function (map, row) {
                    map[row.plz_pk] = row.primary_name;
                    return map;
                }, {}),
                stations: weatherstations.reduce(function (map, row) {
                    map[row.station_pk] = row.name;
                    return map;
                }, {}),
            },
        };
    }
    async ensureDatabase() {
        const baseDir = utils.getAbsoluteInstanceDataDir(this);
        await fs_extra_1.ensureDir(baseDir);
        const filename = path_1.default.join(baseDir, 'db.sqlite');
        try {
            if (!this.database) {
                await this.openDatabase(filename);
            }
            const info = await this.downloadJson('dbinfo.json', true);
            const metadata = await this.database.get('SELECT * FROM metadata');
            if (metadata && info.dbVersion.toString() === metadata.version) {
                this.log.debug(`Database ready: ${metadata === null || metadata === void 0 ? void 0 : metadata.version}`);
                return;
            }
            this.log.debug(`Outdated local database: ${metadata === null || metadata === void 0 ? void 0 : metadata.version} <> ${info.dbVersion}`);
        }
        catch (error) {
            this.log.debug(`Couldn't open local database ${filename}: ${error}`);
        }
        // download the database
        await this.closeDatabase();
        await this.downloadFile('db.sqlite', filename);
        await this.openDatabase(filename);
        this.log.debug(`Database ready`);
    }
    async openDatabase(filename) {
        this.database = await sqlite_1.open({
            filename: filename,
            driver: sqlite3_1.default.cached.Database,
        });
    }
    async closeDatabase() {
        if (this.database) {
            try {
                await this.database.close();
            }
            catch (error) {
                this.log.debug(`Couldn't close database: ${error}`);
            }
        }
    }
    async ensureRegistration() {
        var _a;
        try {
            await this.ensureState(STATE_ID_GCM, 'GCM Credentials', 'object', 'json');
            await this.ensureState(STATE_ID_GCM_PERSISTENCE, 'GCM Persistent IDs', 'array', 'json');
            const currentCredentials = await this.getStateAsync(STATE_ID_GCM);
            let credentials;
            if (typeof (currentCredentials === null || currentCredentials === void 0 ? void 0 : currentCredentials.val) === 'string') {
                credentials = JSON.parse(currentCredentials.val);
            }
            else {
                credentials = await push_receiver_1.register(GCM_SENDER_ID);
                await this.updateValue(STATE_ID_GCM, JSON.stringify(credentials));
            }
            this.log.debug(`GCM: ${JSON.stringify(credentials)}`);
            const plzs = await Promise.all(this.config.zips.map((zip) => this.database.get('SELECT * FROM plz WHERE plz_pk = ?', [zip])));
            const uuid = await this.getForeignObjectAsync('system.meta.uuid');
            const subscription = {
                pushToken: credentials.fcm.token,
                userId: (_a = uuid === null || uuid === void 0 ? void 0 : uuid.native) === null || _a === void 0 ? void 0 : _a.uuid,
                type: 1,
                subscription: plzs
                    .filter((plz) => !!plz)
                    .map((plz, index) => ({
                    plz: plz.plz_pk,
                    name: plz.primary_name,
                    index,
                    config: WARNINGS.filter((w) => w.minimumLevel).map((w) => ({
                        warnLevel: w.minimumLevel,
                        warnType: w.id,
                        withOutlook: true,
                    })),
                })),
            };
            this.log.debug(`Subscription: ${JSON.stringify(subscription)}`);
            await this.axios.post(`${DYNAMIC_BASE_URL}register`, subscription);
            const currentPersistence = await this.getStateAsync(STATE_ID_GCM_PERSISTENCE);
            if (typeof (currentPersistence === null || currentPersistence === void 0 ? void 0 : currentPersistence.val) === 'string') {
                this.persistentIds.push(...JSON.parse(currentPersistence.val));
            }
            await push_receiver_1.listen({ ...credentials, persistentIds: this.persistentIds }, (evt) => this.handleGcmNotification(evt).catch((e) => this.log.error(`Couldn't handle GCM notification: ${e}`)));
        }
        catch (error) {
            this.log.error(`Couldn't register to GCM: ${error}`);
        }
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
        await this.setStateAsync('info.connection', true, true);
    }
    async updateStates(firstRun) {
        let timeout = 0;
        try {
            for (let i = 0; i < this.config.zips.length; i++) {
                const zip = this.config.zips[i];
                await this.updateZip(zip, firstRun);
            }
            const currentWeather = await this.downloadJson('currentWeather.json', true);
            // calculate the next update time from the received timestamp
            // data is updated every 10 minutes, we wait 11 minutes to ensure the data is available on the server
            const now = Date.now();
            const lastUpdate = currentWeather.smnTime;
            timeout = lastUpdate + minutes(11) - now;
            for (let i = 0; i < this.config.stations.length; i++) {
                const station = this.config.stations[i];
                await this.updateStation(station, currentWeather.data[station] || {}, firstRun);
            }
        }
        catch (error) {
            this.log.error(`Update error ${error}`);
        }
        // ensure the next update is between 3 and 11 minutes from now
        timeout = Math.min(Math.max(timeout, minutes(3)), minutes(11));
        // randomize the timeout so not everybody sends a request at the same time (+/- 30 seconds)
        timeout += minutes(Math.random() - 0.5);
        this.log.debug(`Next update will be in ${timeout / 1000} seconds`);
        this.refreshTimer = setTimeout(() => this.refresh(), timeout);
    }
    refresh() {
        this.log.info('Refreshing data');
        this.updateStates(false).catch((e) => this.log.error(`Update error ${e}`));
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
        await this.updateValue(`${zip}.currentWeather.iconUrl`, toWeatherIconUrl(detail.currentWeather.icon));
        await this.updateValue(`${zip}.currentWeather.temperature`, detail.currentWeather.temperature);
        // forecast (8 days)
        for (let day = 0; day < 8; day++) {
            const channel = `${zip}.forecast-${day}`;
            if (firstRun) {
                await this.ensureChannel(channel, `Forecast ${getDayName(day)}`);
                await this.ensureState(`${channel}.date`, 'Date', 'string', `date.forecast.${day}`);
                await this.ensureState(`${channel}.icon`, 'Icon', 'number', 'value');
                await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                await this.ensureState(`${channel}.temperatureMax`, 'Temperature Max', 'number', `value.temperature.max.forecast.${day}`, '°C');
                await this.ensureState(`${channel}.temperatureMin`, 'Temperature Min', 'number', `value.temperature.min.forecast.${day}`, '°C');
                await this.ensureState(`${channel}.precipitation`, 'Precipitation', 'number', `value.precipitation.forecast.${day}`, 'mm');
            }
            const forecast = detail.forecast[day];
            await this.updateValue(`${channel}.date`, forecast === null || forecast === void 0 ? void 0 : forecast.dayDate);
            await this.updateValue(`${channel}.icon`, forecast === null || forecast === void 0 ? void 0 : forecast.iconDay);
            await this.updateValue(`${channel}.iconUrl`, toWeatherIconUrl(forecast === null || forecast === void 0 ? void 0 : forecast.iconDay));
            await this.updateValue(`${channel}.temperatureMax`, forecast === null || forecast === void 0 ? void 0 : forecast.temperatureMax);
            await this.updateValue(`${channel}.temperatureMin`, forecast === null || forecast === void 0 ? void 0 : forecast.temperatureMin);
            await this.updateValue(`${channel}.precipitation`, forecast === null || forecast === void 0 ? void 0 : forecast.precipitation);
        }
        // 3 hour slots
        let precipitationIndex10m = 0;
        let precipitationIndex1h = 0;
        for (let day = 0; day < 8; day++) {
            for (let hour = 0; hour < 24; hour += 3) {
                const index1h = day * 24 + hour;
                const index3h = index1h / 3;
                const h = hour > 9 ? hour.toString() : '0' + hour;
                const channel = `${zip}.day-${day}-hour-${h}`;
                if (firstRun) {
                    await this.ensureChannel(channel, `${getDayName(day)} @ ${h}:00`);
                    await this.ensureState(`${channel}.time`, 'Time', 'string', 'date');
                    await this.ensureState(`${channel}.icon`, 'Icon', 'number', 'value');
                    await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                    await this.ensureState(`${channel}.windDirection`, 'Wind Direction', 'number', 'value.direction.wind', '°');
                    await this.ensureState(`${channel}.windSpeed`, 'Wind Speed', 'number', 'value.speed.wind', 'km/h');
                    await this.ensureState(`${channel}.temperatureMin`, 'Temperature Min', 'number', 'value.temperature.min', '°C');
                    await this.ensureState(`${channel}.temperatureMax`, 'Temperature Max', 'number', 'value.temperature.max', '°C');
                    await this.ensureState(`${channel}.temperatureMean`, 'Temperature Mean', 'number', 'value.temperature', '°C');
                    await this.ensureState(`${channel}.precipitation`, 'Precipitation', 'number', 'value.precipitation', 'mm');
                }
                const offset = (day * 24 + hour) * minutes(60);
                const now = detail.graph.start + offset;
                await this.updateValue(`${channel}.time`, toDateStr(now));
                const icon = detail.graph.weatherIcon3hV2[index3h];
                await this.updateValue(`${channel}.icon`, icon);
                await this.updateValue(`${channel}.iconUrl`, toWeatherIconUrl(icon));
                await this.updateValue(`${channel}.windDirection`, detail.graph.windDirection3h[index3h]);
                await this.updateValue(`${channel}.windSpeed`, detail.graph.windSpeed3h[index3h]);
                await this.updateValue(`${channel}.temperatureMin`, Math.min(...detail.graph.temperatureMin1h.slice(index1h, index1h + 3)));
                await this.updateValue(`${channel}.temperatureMax`, Math.max(...detail.graph.temperatureMax1h.slice(index1h, index1h + 3)));
                await this.updateValue(`${channel}.temperatureMean`, detail.graph.temperatureMean1h.slice(index1h, index1h + 3).reduce((a, b) => a + b) / 3);
                let precipitationSum = 0;
                for (let p = 0; p < 18; p++) {
                    // 18 = 3h * 6 "10-minute-intervals"
                    if (now + p * minutes(10) < detail.graph.startLowResolution) {
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
        // warnings
        for (const category of WARNINGS) {
            const channel = `${zip}.warning-${category.id.toString().padStart(2, '0')}`;
            if (firstRun) {
                await this.ensureChannel(channel, category.name);
                await this.ensureState(`${channel}.level`, 'Hazard level', 'number', 'value', undefined, {
                    0: 'None',
                    1: 'Minimal',
                    2: 'Moderate',
                    3: 'Significant',
                    4: 'Severe',
                    5: 'Very severe',
                });
                await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                await this.ensureState(`${channel}.text`, 'Text', 'string', 'text');
                await this.ensureState(`${channel}.html`, 'HTML', 'string', 'html');
                await this.ensureState(`${channel}.validFrom`, 'Valid from', 'string', 'date');
                await this.ensureState(`${channel}.validTo`, 'Valid to', 'string', 'date');
                await this.ensureState(`${channel}.outlook`, 'Is outlook', 'boolean', 'indicator');
            }
            let warning;
            const warnings = detail.warnings.filter((w) => w.warnType === category.id);
            warnings.sort((a, b) => b.warnLevel - a.warnLevel);
            if (warnings.length === 1) {
                warning = warnings[0];
            }
            else if (warnings.length > 1) {
                warning = warnings.find((w) => !w.outlook) || warnings[0];
            }
            await this.updateWarning(channel, category.id.toString(), warning);
        }
    }
    async handleGcmNotification(evt) {
        const { notification, persistentId } = evt;
        // Update list of persistentId
        this.persistentIds.push(persistentId);
        await this.updateValue(STATE_ID_GCM_PERSISTENCE, JSON.stringify(this.persistentIds));
        this.log.debug(`Notification: ${JSON.stringify(notification)}`);
        const warning = notification.data;
        const channel = `${warning.plz}.warning-${warning.warnType.padStart(2, '0')}`;
        const states = await this.getStatesAsync(`${channel}.*`);
        if (!states || Object.keys(states).length === 0) {
            throw new Error(`Received warning ${warning.warnType} for ${warning.plz}, but couldn't find channel.`);
        }
        const currentLevel = states[`${channel}.level`];
        if (typeof (currentLevel === null || currentLevel === void 0 ? void 0 : currentLevel.val) === 'number' && currentLevel.val > parseInt(warning.warnLevel)) {
            // the received warning has a lower level
            const currentOutlook = states[`${channel}.outlook`];
            if ((currentOutlook === null || currentOutlook === void 0 ? void 0 : currentOutlook.val) !== true || warning.outlook === 'true') {
                // only allow for lower level if the received warning is not outlook and the existing one is
                this.log.debug(`Ignoring warning ${warning.warnType} for ${warning.plz} because of lower level`);
                return;
            }
        }
        await this.updateWarning(channel, warning.warnType, {
            warnType: parseInt(warning.warnType),
            warnLevel: parseInt(warning.warnLevel),
            text: warning.warnText,
            validFrom: parseNumber(warning.validFrom),
            validTo: parseNumber(warning.validTo),
            ordering: warning.ordering,
            htmlText: warning.warnText,
            outlook: warning.outlook === 'true',
            links: [],
        });
    }
    async updateWarning(channel, type, warning) {
        await this.updateValue(`${channel}.level`, (warning === null || warning === void 0 ? void 0 : warning.warnLevel) || 0);
        await this.updateValue(`${channel}.iconUrl`, warning ? WARNING_ICON_URL_FORMAT.replace('%s', type).replace('%s', warning.warnLevel.toString()) : null);
        await this.updateValue(`${channel}.text`, warning === null || warning === void 0 ? void 0 : warning.text);
        await this.updateValue(`${channel}.html`, warning === null || warning === void 0 ? void 0 : warning.htmlText);
        await this.updateValue(`${channel}.validFrom`, toDateStr(warning === null || warning === void 0 ? void 0 : warning.validFrom));
        await this.updateValue(`${channel}.validTo`, toDateStr(warning === null || warning === void 0 ? void 0 : warning.validTo));
        await this.updateValue(`${channel}.outlook`, warning === null || warning === void 0 ? void 0 : warning.outlook);
    }
    /**
     * We used short variable names here to make the code below as short as possible.
     *
     * @param s The station ID.
     * @param m The measurements at the station.
     * @param f Flag to know if we should create states.
     */
    async updateStation(s, m, f) {
        this.log.debug(`Updating ${s}`);
        await this.updateValueTime(s, m.temperatureMin, 'temperatureMin', 'Temperature Min', 'value.temperature', '°C', f);
        await this.updateValueTime(s, m.temperatureMax, 'temperatureMax', 'Temperature Max', 'value.temperature', '°C', f);
        await this.updateMsmt(s, m.sunshineTotal, 'sunshineTotal', 'Sunshine Total', 'value', 'min', f);
        await this.updateMsmt(s, m.sunshineYesterday, 'sunshineYesterday', 'Sunshine Yesterday', 'value', 'min', f);
        await this.updateMsmt(s, m.precipitation1H, 'precipitation1H', 'Precipitation 1 Hour', 'value.precipitation', 'mm', f);
        await this.updateMsmt(s, m.precipitationYesterday, 'precipitationYesterday', 'Precipitation Yesterday', 'value.precipitation', 'mm', f);
        await this.updateMsmt(s, m.precipitation24H, 'precipitation24H', 'Precipitation 24 Hours', 'value.precipitation', 'mm', f);
        await this.updateMsmt(s, m.precipitation48H, 'precipitation48H', 'Precipitation 48 Hours', 'value.precipitation', 'mm', f);
        await this.updateMsmt(s, m.precipitation72H, 'precipitation72H', 'Precipitation 72 Hours', 'value.precipitation', 'mm', f);
        await this.updateValueTime(s, m.windGustMax, 'windGustMax', 'Wind Gust Max', 'value.speed.wind', 'km/h', f);
        await this.updateMsmt(s, m.pressureDifference3H, 'pressureDifference3H', 'Pressure Difference 3 Hours', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.pressure850, 'pressure850', 'Pressure 850', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.pressure700, 'pressure700', 'Pressure 700', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.snow2D, 'snow2D', 'Snow 2 Days', 'value', 'cm', f);
        await this.updateMsmt(s, m.snow3D, 'snow3D', 'Snow 3 Days', 'value', 'cm', f);
        await this.updateMsmt(s, m.dewPoint, 'dewPoint', 'Dew Point', 'value.temperature', '°C', f);
        await this.updateMsmt(s, m.windSpeed, 'windSpeed', 'Wind Speed', 'value.speed.wind', 'km/h', f);
        await this.updateMsmt(s, m.precipitation, 'precipitation', 'Precipitation', 'value.precipitation', 'mm', f);
        await this.updateMsmt(s, m.humidity, 'humidity', 'Humidity', 'value.humidity', '%', f);
        await this.updateMsmt(s, m.pressureSea, 'pressureSea', 'Pressure reduced to sea level (QFF)', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.pressureStandard, 'pressureStandard', 'Pressure with standard atmosphere (QNH)', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.pressureStation, 'pressureStation', 'Pressure at station (QFE)', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.windDirection, 'windDirection', 'Wind Direction', 'value.direction.wind', '°', f);
        await this.updateMsmt(s, m.windGust, 'windGust', 'Wind Gust', 'value.speed.wind', 'km/h', f);
        await this.updateValueTime(s, { timestamp: m.snowTime, value: m.snowNew }, 'snowNew', 'Snow New', 'value', 'cm', f);
        await this.updateValueTime(s, { timestamp: m.snowTime, value: m.snowTotal }, 'snowTotal', 'Snow Total', 'value', 'cm', f);
        await this.updateMsmt(s, m.temperature, 'temperature', 'Temperature', 'value.temperature', '°C', f);
        f && (await this.ensureState(`${s}.smnTime`, 'Time', 'string', 'date'));
        await this.updateValue(`${s}.smnTime`, toDateStr(m.smnTime));
        await this.updateMsmt(s, m.sunshine, 'sunshine', 'Sunshine', 'value', 'min', f);
        await this.updateValueTime(s, { timestamp: m.foehnTime, value: m.foehn }, 'foehn', 'Foehn-Index', 'value', 'cm', f);
    }
    async updateValueTime(station, tuple, id, name, role, unit, firstRun) {
        if (!(tuple === null || tuple === void 0 ? void 0 : tuple.timestamp)) {
            return;
        }
        const channel = `${station}.${id}`;
        if (firstRun) {
            await this.ensureChannel(channel, name);
            await this.ensureState(`${channel}.time`, 'Time', 'string', 'date');
            await this.ensureState(`${channel}.value`, name, 'number', role, unit);
        }
        await this.updateValue(`${channel}.time`, toDateStr(tuple.timestamp));
        await this.updateValue(`${channel}.value`, toNumber(tuple.value));
    }
    async updateMsmt(station, value, id, name, role, unit, firstRun) {
        if (value === undefined) {
            return;
        }
        const fullId = `${station}.${id}`;
        if (firstRun) {
            await this.ensureState(fullId, name, 'number', role, unit);
        }
        await this.updateValue(fullId, toNumber(value));
    }
    async downloadJson(filename, isStaticResource) {
        const url = `${isStaticResource ? STATIC_BASE_URL : DYNAMIC_BASE_URL}${filename}`;
        this.log.debug(`Downloading ${url}`);
        const response = await this.axios.get(url);
        // this.log.silly(`Received ${JSON.stringify(response.data)}`);
        return response.data;
    }
    async downloadFile(srcUrl, destPath) {
        const url = `${STATIC_BASE_URL}${srcUrl}`;
        this.log.debug(`Downloading file ${url} to ${destPath}`);
        const writer = fs_extra_1.createWriteStream(destPath);
        const response = await this.axios.get(url, {
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
    async ensureState(id, name, type, role, unit, states) {
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name,
                type,
                role,
                unit,
                states,
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
