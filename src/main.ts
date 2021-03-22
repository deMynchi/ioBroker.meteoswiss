/*
 * Created with @iobroker/create-adapter v1.32.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import axios, { AxiosInstance } from 'axios';
import { createWriteStream, ensureDir } from 'fs-extra';
import path from 'path';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Db, Rest } from './meteoswiss';

const STATIC_BASE_URL = 'https://s3-eu-central-1.amazonaws.com/app-prod-static-fra.meteoswiss-app.ch/v1/';
const DYNAMIC_BASE_URL = 'https://app-prod-ws.meteoswiss-app.ch/v1/';
const USER_AGENT = 'Android-30 ch.admin.meteoswiss-2410';
const ICON_URL_FORMAT = 'https://cdn.jsdelivr.net/npm/meteo-icons/icons/weathericon_%s.png';

function toDateStr(timestamp: number | undefined): string | undefined {
    return timestamp ? new Date(timestamp).toISOString() : undefined;
}

function toNumber(value?: number): number | undefined {
    return value === 32767 ? undefined : value;
}

function toIconUrl(icon?: number): string | undefined {
    if (icon === undefined) {
        return undefined;
    }
    let num = icon.toString();
    while (num.length < 3) {
        num = '0' + num;
    }
    return ICON_URL_FORMAT.replace('%s', num);
}

/**
 * Converts minutes to milliseconds for better readability.
 *
 * @param minutes The number of minutes-
 * @returns The total number of milliseconds.
 */
function minutes(minutes: number): number {
    return minutes * 60 * 1000;
}

interface GetDataResponse {
    error?: any;
    data?: {
        zips: Record<number, string>;
        stations: Record<string, string>;
    };
}

class MeteoSwiss extends utils.Adapter {
    private axios!: AxiosInstance;
    private database!: Database<sqlite3.Database, sqlite3.Statement>;
    private refreshTimer?: NodeJS.Timeout;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
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
    private async onReady(): Promise<void> {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        this.axios = axios.create({
            headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip',
                'Accept-Language': this.config.language || 'de',
                'User-Agent': USER_AGENT,
            },
        });

        await this.ensureDatabase();

        await this.createObjects();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        this.unload().finally(callback);
    }

    private async unload(): Promise<void> {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        await this.closeDatabase();
    }

    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     */
    private onMessage(msg: ioBroker.Message): void {
        // this.log.info('onMessage() :' + JSON.stringify(msg));
        if (
            typeof msg === 'object' &&
            msg.command === 'getData' &&
            msg.callback &&
            msg.from &&
            msg.from.startsWith('system.adapter.admin')
        ) {
            this.handleGetDataMessage()
                .then((response) => this.sendTo(msg.from, msg.command, response, msg.callback))
                .catch((e) => {
                    this.log.warn(`Couldn't handle getData message: ${e}`);
                    this.sendTo(msg.from, msg.command, { error: e || 'No data' }, msg.callback);
                });
        }
    }

    private async handleGetDataMessage(): Promise<GetDataResponse> {
        await this.ensureDatabase();

        const plzs = await this.database.all<Db.Plz[]>('SELECT plz_pk, primary_name FROM plz');
        const weatherstations = await this.database.all<Db.Wetterstation[]>(
            'SELECT station_pk, name FROM wetterstation',
        );

        return {
            data: {
                zips: plzs.reduce<Record<number, string>>(function (map, row) {
                    map[row.plz_pk] = row.primary_name;
                    return map;
                }, {}),
                stations: weatherstations.reduce<Record<string, string>>(function (map, row) {
                    map[row.station_pk] = row.name;
                    return map;
                }, {}),
            },
        };
    }

    private async ensureDatabase(): Promise<void> {
        const baseDir = utils.getAbsoluteInstanceDataDir(this);
        await ensureDir(baseDir);

        const filename = path.join(baseDir, 'db.sqlite');
        try {
            if (!this.database) {
                await this.openDatabase(filename);
            }

            const info = await this.downloadJson<Rest.DbInfo>('dbinfo.json', true);

            const metadata = await this.database.get<Db.Metadata>('SELECT * FROM metadata');
            if (metadata && info.dbVersion.toString() === metadata.version) {
                this.log.debug(`Database ready: ${metadata?.version}`);
                return;
            }

            this.log.debug(`Outdated local database: ${metadata?.version} <> ${info.dbVersion}`);
        } catch (error) {
            this.log.debug(`Couldn't open local database ${filename}: ${error}`);
        }

        // download the database
        await this.closeDatabase();
        await this.downloadFile('db.sqlite', filename);
        await this.openDatabase(filename);
        this.log.debug(`Database ready`);
    }

    private async openDatabase(filename: string): Promise<void> {
        this.database = await open({
            filename: filename,
            driver: sqlite3.cached.Database,
        });
    }

    private async closeDatabase(): Promise<void> {
        if (this.database) {
            try {
                await this.database.close();
            } catch (error) {
                this.log.debug(`Couldn't close database: ${error}`);
            }
        }
    }

    private async createObjects(): Promise<void> {
        for (let i = this.config.zips.length - 1; i >= 0; i--) {
            const zip = this.config.zips[i];
            try {
                this.log.debug(`Creating objects for ${zip}`);
                const plz = await this.database.get<Db.Plz>('SELECT * FROM plz WHERE plz_pk = ?', [zip]);
                if (!plz) {
                    throw new Error(`Couldn't find PLZ ${zip}`);
                }
                await this.ensureDevice(zip.toString(), plz.primary_name);
            } catch (error) {
                this.log.warn(`Couldn't create objects for ${zip}, not polling its values`);
                this.config.zips.splice(i, 1);
            }
        }

        for (let i = this.config.stations.length - 1; i >= 0; i--) {
            const station = this.config.stations[i];
            try {
                this.log.debug(`Creating objects for ${station}`);
                const wetterstation = await this.database.get<Db.Wetterstation>(
                    'SELECT * FROM wetterstation WHERE station_pk = ?',
                    [station],
                );
                if (!wetterstation) {
                    throw new Error(`Couldn't find station ${station}`);
                }
                await this.ensureDevice(station, `Station ${wetterstation.name}`);
            } catch (error) {
                this.log.warn(`Couldn't create objects for ${station}, not polling its values`);
                this.config.stations.splice(i, 1);
            }
        }

        await this.updateStates(true);
    }

    private async updateStates(firstRun: boolean): Promise<void> {
        let timeout = 0;
        try {
            for (let i = 0; i < this.config.zips.length; i++) {
                const zip = this.config.zips[i];
                await this.updateZip(zip, firstRun);
            }

            const currentWeather = await this.downloadJson<Rest.CurrentWeather>('currentWeather.json', true);

            // calculate the next update time from the received timestamp
            // data is updated every 10 minutes, we wait 11 minutes to ensure the data is available on the server
            const now = Date.now();
            const lastUpdate = currentWeather.smnTime;
            timeout = lastUpdate + minutes(11) - now;

            for (let i = 0; i < this.config.stations.length; i++) {
                const station = this.config.stations[i];
                await this.updateStation(station, currentWeather.data[station] || {}, firstRun);
            }
        } catch (error) {
            this.log.error(`Update error ${error}`);
        }

        // ensure the next update is between 3 and 11 minutes from now
        timeout = Math.min(Math.max(timeout, minutes(3)), minutes(11));

        // randomize the timeout so not everybody sends a request at the same time (+/- 30 seconds)
        timeout += minutes(Math.random() - 0.5);
        this.log.debug(`Next update will be in ${timeout / 1000} seconds`);
        this.refreshTimer = setTimeout(() => this.refresh(), timeout);
    }

    private refresh(): void {
        this.log.info('Refreshing data');
        this.updateStates(false).catch((e) => this.log.error(`Update error ${e}`));
    }

    private async updateZip(zip: number, firstRun: boolean): Promise<void> {
        this.log.debug(`Updating ${zip}`);

        const detail = await this.downloadJson<Rest.PlzDetail>(`plzDetail?plz=${zip}`, false);

        // currentWeather
        if (firstRun) {
            await this.ensureChannel(`${zip}.currentWeather`, 'Current Weather');
            await this.ensureState(`${zip}.currentWeather.time`, 'Time', 'string', 'date');
            await this.ensureState(`${zip}.currentWeather.icon`, 'Icon', 'number', 'value');
            await this.ensureState(`${zip}.currentWeather.iconUrl`, 'Icon URL', 'string', 'text.url');

            await this.ensureState(
                `${zip}.currentWeather.temperature`,
                'Temperature',
                'number',
                'value.temperature',
                '°C',
            );
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
                await this.ensureState(`${channel}.date`, 'Date', 'string', `date.forecast.${day}`);
                await this.ensureState(`${channel}.icon`, 'Icon', 'number', 'value');
                await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                await this.ensureState(
                    `${channel}.temperatureMax`,
                    'Temperature Max',
                    'number',
                    `value.temperature.max.forecast.${day}`,
                    '°C',
                );
                await this.ensureState(
                    `${channel}.temperatureMin`,
                    'Temperature Min',
                    'number',
                    `value.temperature.min.forecast.${day}`,
                    '°C',
                );
                await this.ensureState(
                    `${channel}.precipitation`,
                    'Precipitation',
                    'number',
                    `value.precipitation.forecast.${day}`,
                    'mm',
                );
            }

            const forecast = detail.forecast[day];
            await this.updateValue(`${channel}.date`, forecast?.dayDate);
            await this.updateValue(`${channel}.icon`, forecast?.iconDay);
            await this.updateValue(`${channel}.iconUrl`, toIconUrl(forecast?.iconDay));
            await this.updateValue(`${channel}.temperatureMax`, forecast?.temperatureMax);
            await this.updateValue(`${channel}.temperatureMin`, forecast?.temperatureMin);
            await this.updateValue(`${channel}.precipitation`, forecast?.precipitation);
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
                    await this.ensureState(
                        `${channel}.windDirection`,
                        'Wind Direction',
                        'number',
                        'value.direction.wind',
                        '°',
                    );
                    await this.ensureState(`${channel}.windSpeed`, 'Wind Speed', 'number', 'value.speed.wind', 'km/h');
                    await this.ensureState(
                        `${channel}.temperatureMin`,
                        'Temperature Min',
                        'number',
                        'value.temperature.min',
                        '°C',
                    );
                    await this.ensureState(
                        `${channel}.temperatureMax`,
                        'Temperature Max',
                        'number',
                        'value.temperature.max',
                        '°C',
                    );
                    await this.ensureState(
                        `${channel}.temperatureMean`,
                        'Temperature Mean',
                        'number',
                        'value.temperature',
                        '°C',
                    );
                    await this.ensureState(
                        `${channel}.precipitation`,
                        'Precipitation',
                        'number',
                        'value.precipitation',
                        'mm',
                    );
                }

                const offset = (day * 24 + hour) * minutes(60);
                const now = detail.graph.start + offset;
                await this.updateValue(`${channel}.time`, toDateStr(now));

                const icon = detail.graph.weatherIcon3h[index3h];
                await this.updateValue(`${channel}.icon`, icon);
                await this.updateValue(`${channel}.iconUrl`, toIconUrl(icon));
                await this.updateValue(`${channel}.windDirection`, detail.graph.windDirection3h[index3h]);
                await this.updateValue(`${channel}.windSpeed`, detail.graph.windSpeed3h[index3h]);

                await this.updateValue(
                    `${channel}.temperatureMin`,
                    Math.min(...detail.graph.temperatureMin1h.slice(index1h, index1h + 3)),
                );
                await this.updateValue(
                    `${channel}.temperatureMax`,
                    Math.max(...detail.graph.temperatureMax1h.slice(index1h, index1h + 3)),
                );
                await this.updateValue(
                    `${channel}.temperatureMean`,
                    detail.graph.temperatureMean1h.slice(index1h, index1h + 3).reduce((a, b) => a + b) / 3,
                );

                let precipitationSum = 0;
                for (let p = 0; p < 18; p++) {
                    // 18 = 3h * 6 "10-minute-intervals"
                    if (now + p * minutes(10) < detail.graph.startLowResolution) {
                        precipitationSum += detail.graph.precipitation10m[precipitationIndex10m];
                        precipitationIndex10m++;
                    } else {
                        precipitationSum += detail.graph.precipitation1h[precipitationIndex1h] * 6;
                        precipitationIndex1h++;
                        p += 5;
                    }
                }
                await this.updateValue(`${channel}.precipitation`, (precipitationSum / 18) * 3);
            }
        }
    }

    /**
     * We used short variable names here to make the code below as short as possible.
     *
     * @param s The station ID.
     * @param m The measurements at the station.
     * @param f Flag to know if we should create states.
     */
    private async updateStation(s: string, m: Rest.StationMeasurements, f: boolean): Promise<void> {
        this.log.debug(`Updating ${s}`);

        await this.updateValueTime(
            s,
            m.temperatureMin,
            'temperatureMin',
            'Temperature Min',
            'value.temperature',
            '°C',
            f,
        );
        await this.updateValueTime(
            s,
            m.temperatureMax,
            'temperatureMax',
            'Temperature Max',
            'value.temperature',
            '°C',
            f,
        );

        await this.updateMsmt(s, m.sunshineTotal, 'sunshineTotal', 'Sunshine Total', 'value', 'min', f);
        await this.updateMsmt(s, m.sunshineYesterday, 'sunshineYesterday', 'Sunshine Yesterday', 'value', 'min', f);
        await this.updateMsmt(
            s,
            m.precipitation1H,
            'precipitation1H',
            'Precipitation 1 Hour',
            'value.precipitation',
            'mm',
            f,
        );
        await this.updateMsmt(
            s,
            m.precipitationYesterday,
            'precipitationYesterday',
            'Precipitation Yesterday',
            'value.precipitation',
            'mm',
            f,
        );
        await this.updateMsmt(
            s,
            m.precipitation24H,
            'precipitation24H',
            'Precipitation 24 Hours',
            'value.precipitation',
            'mm',
            f,
        );
        await this.updateMsmt(
            s,
            m.precipitation48H,
            'precipitation48H',
            'Precipitation 48 Hours',
            'value.precipitation',
            'mm',
            f,
        );
        await this.updateMsmt(
            s,
            m.precipitation72H,
            'precipitation72H',
            'Precipitation 72 Hours',
            'value.precipitation',
            'mm',
            f,
        );

        await this.updateValueTime(s, m.windGustMax, 'windGustMax', 'Wind Gust Max', 'value.speed.wind', 'km/h', f);

        await this.updateMsmt(
            s,
            m.pressureDifference3H,
            'pressureDifference3H',
            'Pressure Difference 3 Hours',
            'value.pressure',
            'hPa',
            f,
        );
        await this.updateMsmt(s, m.pressure850, 'pressure850', 'Pressure 850', 'value.pressure', 'hPa', f);
        await this.updateMsmt(s, m.pressure700, 'pressure700', 'Pressure 700', 'value.pressure', 'hPa', f);

        await this.updateMsmt(s, m.snow2D, 'snow2D', 'Snow 2 Days', 'value', 'cm', f);
        await this.updateMsmt(s, m.snow3D, 'snow3D', 'Snow 3 Days', 'value', 'cm', f);

        await this.updateMsmt(s, m.dewPoint, 'dewPoint', 'Dew Point', 'value.temperature', '°C', f);

        await this.updateMsmt(s, m.windSpeed, 'windSpeed', 'Wind Speed', 'value.speed.wind', 'km/h', f);

        await this.updateMsmt(s, m.precipitation, 'precipitation', 'Precipitation', 'value.precipitation', 'mm', f);
        await this.updateMsmt(s, m.humidity, 'humidity', 'Humidity', 'value.humidity', '%', f);

        await this.updateMsmt(
            s,
            m.pressureSea,
            'pressureSea',
            'Pressure reduced to sea level (QFF)',
            'value.pressure',
            'hPa',
            f,
        );
        await this.updateMsmt(
            s,
            m.pressureStandard,
            'pressureStandard',
            'Pressure with standard atmosphere (QNH)',
            'value.pressure',
            'hPa',
            f,
        );
        await this.updateMsmt(
            s,
            m.pressureStation,
            'pressureStation',
            'Pressure at station (QFE)',
            'value.pressure',
            'hPa',
            f,
        );

        await this.updateMsmt(s, m.windDirection, 'windDirection', 'Wind Direction', 'value.direction.wind', '°', f);
        await this.updateMsmt(s, m.windGust, 'windGust', 'Wind Gust', 'value.speed.wind', 'km/h', f);

        await this.updateValueTime(
            s,
            { timestamp: m.snowTime, value: m.snowNew },
            'snowNew',
            'Snow New',
            'value',
            'cm',
            f,
        );
        await this.updateValueTime(
            s,
            { timestamp: m.snowTime, value: m.snowTotal },
            'snowTotal',
            'Snow Total',
            'value',
            'cm',
            f,
        );

        await this.updateMsmt(s, m.temperature, 'temperature', 'Temperature', 'value.temperature', '°C', f);

        f && (await this.ensureState(`${s}.smnTime`, 'Time', 'string', 'date'));
        await this.updateValue(`${s}.smnTime`, toDateStr(m.smnTime));

        await this.updateMsmt(s, m.sunshine, 'sunshine', 'Sunshine', 'value', 'min', f);

        await this.updateValueTime(
            s,
            { timestamp: m.foehnTime, value: m.foehn },
            'foehn',
            'Foehn-Index',
            'value',
            'cm',
            f,
        );
    }

    private async updateValueTime(
        station: string,
        tuple:
            | {
                  value?: number;
                  timestamp?: number;
              }
            | undefined,
        id: string,
        name: string,
        role: string,
        unit: string | undefined,
        firstRun: boolean,
    ): Promise<void> {
        if (!tuple?.timestamp) {
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

    private async updateMsmt(
        station: string,
        value: number | undefined,
        id: string,
        name: string,
        role: string,
        unit: string | undefined,
        firstRun: boolean,
    ): Promise<void> {
        if (value === undefined) {
            return;
        }

        const fullId = `${station}.${id}`;

        if (firstRun) {
            await this.ensureState(fullId, name, 'number', role, unit);
        }

        await this.updateValue(fullId, toNumber(value));
    }

    private async downloadJson<T>(filename: string, isStaticResource: boolean): Promise<T> {
        const url = `${isStaticResource ? STATIC_BASE_URL : DYNAMIC_BASE_URL}${filename}`;
        this.log.debug(`Downloading ${url}`);
        const response = await this.axios.get<T>(url);
        // this.log.silly(`Received ${JSON.stringify(response.data)}`);
        return response.data;
    }

    private async downloadFile(srcUrl: string, destPath: string): Promise<void> {
        const url = `${STATIC_BASE_URL}${srcUrl}`;
        this.log.debug(`Downloading file ${url} to ${destPath}`);
        const writer = createWriteStream(destPath);

        const response = await this.axios.get(url, {
            responseType: 'stream',
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    private async ensureDevice(id: string, name: string): Promise<void> {
        await this.setObjectNotExistsAsync(id, {
            type: 'device',
            common: {
                name,
            },
            native: {},
        });
    }

    private async ensureChannel(id: string, name: string): Promise<void> {
        await this.setObjectNotExistsAsync(id, {
            type: 'channel',
            common: {
                name,
            },
            native: {},
        });
    }

    private async ensureState(
        id: string,
        name: string,
        type: ioBroker.CommonType,
        role: string,
        unit?: string,
    ): Promise<void> {
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

    private async updateValue(id: string, value: number | string | boolean | null | undefined): Promise<void> {
        if (value === undefined) {
            value = null;
        }
        await this.setStateAsync(id, value, true);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new MeteoSwiss(options);
} else {
    // otherwise start the instance directly
    (() => new MeteoSwiss())();
}
