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

function toDateStr(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function toIconUrl(icon: number): string | undefined {
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
    private axios!: AxiosInstance;
    private database!: Database<sqlite3.Database, sqlite3.Statement>;

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
    private onUnload(callback: () => void): void {
        this.unload().finally(callback);
    }

    private async unload(): Promise<void> {
        await this.database.close();
    }

    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     */
    private onMessage(obj: ioBroker.Message): void {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'send') {
                // e.g. send email or pushover or whatever
                this.log.info('send command');
                // Send response in callback if required
                if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
            }
        }
    }

    private async loadDatabase(): Promise<void> {
        const baseDir = utils.getAbsoluteInstanceDataDir(this);
        await ensureDir(baseDir);

        const filename = path.join(baseDir, 'db.sqlite');
        try {
            await this.openDatabase(filename);

            // TODO: check version
            const info = await this.downloadJson<Rest.DbInfo>('dbinfo.json', true);

            const metadata = await this.database.get<Db.Metadata>('SELECT * FROM metadata');
            if (metadata && info.dbVersion.toString() === metadata.version) {
                return;
            }

            this.log.debug(`Outdated local database: ${metadata?.version} <> ${info.dbVersion}`);
        } catch (error) {
            this.log.debug(`Couldn't open local database ${filename}: ${error}`);
        }

        // download the database
        await this.downloadFile('db.sqlite', filename);
        await this.openDatabase(filename);
    }

    private async openDatabase(filename: string): Promise<void> {
        if (this.database) {
            await this.database.close();
        }

        this.database = await open({
            filename: filename,
            driver: sqlite3.cached.Database,
        });
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
        for (let i = 0; i < this.config.zips.length; i++) {
            const zip = this.config.zips[i];
            await this.updateZip(zip, firstRun);
        }

        for (let i = 0; i < this.config.stations.length; i++) {
            const station = this.config.stations[i];
            await this.updateStation(station, firstRun);
        }
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
                await this.ensureState(`${channel}.date`, 'Date', 'string', 'text');
                await this.ensureState(`${channel}.icon`, 'Icon', 'number', 'value');
                await this.ensureState(`${channel}.iconUrl`, 'Icon URL', 'string', 'text.url');
                await this.ensureState(
                    `${channel}.temperatureMax`,
                    'Temperature Max',
                    'number',
                    'value.temperature',
                    '°C',
                );
                await this.ensureState(
                    `${channel}.temperatureMin`,
                    'Temperature Min',
                    'number',
                    'value.temperature',
                    '°C',
                );
                await this.ensureState(`${channel}.precipitation`, 'Precipitation', 'number', 'value', 'mm');
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
                    await this.ensureState(`${channel}.windDirection`, 'Wind Direction', 'number', 'value', '°');
                    await this.ensureState(`${channel}.windSpeed`, 'Wind Speed', 'number', 'value.speed', 'km/h');
                    await this.ensureState(
                        `${channel}.temperatureMin`,
                        'Temperature Min',
                        'number',
                        'value.temperature',
                        '°C',
                    );
                    await this.ensureState(
                        `${channel}.temperatureMax`,
                        'Temperature Max',
                        'number',
                        'value.temperature',
                        '°C',
                    );
                    await this.ensureState(
                        `${channel}.temperatureMean`,
                        'Temperature Mean',
                        'number',
                        'value.temperature',
                        '°C',
                    );
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
                    if (now + p * 10 * 60 * 1000 < detail.graph.startLowResolution) {
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

    private async updateStation(station: string, firstRun: boolean): Promise<void> {
        this.log.debug(`Updating ${station}`);
    }

    private async downloadJson<T>(filename: string, isStaticResource: boolean): Promise<T> {
        const url = `${isStaticResource ? STATIC_BASE_URL : DYNAMIC_BASE_URL}${filename}`;
        this.log.debug(`Downloading ${url}`);
        const response = await this.axios.get<T>(url);
        this.log.debug(`Received ${JSON.stringify(response.data)}`);
        return response.data;
    }

    private async downloadFile(srcUrl: string, destPath: string): Promise<void> {
        this.log.debug(`Downloading ${STATIC_BASE_URL}${srcUrl}`);
        const writer = createWriteStream(destPath);

        const response = await this.axios.get(srcUrl, {
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
