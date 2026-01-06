/**
 * Type definitions for MeteoSwiss "REST" API
 */
export namespace Rest {
    /**
     * Database information returned by dbinfo.json endpoint
     */
    export interface DbInfo {
        /** The current database version. This must match the version in the database (table metadata). */
        dbVersion: number;
        /** The checksum of the database. */
        checksum: string;
        /** Unknown field. */
        gaiRate: number;
        /** Timestamp of the database information. */
        timestamp: number;
    }

    /**
     * Current weather information for a postal code.
     */
    export interface CurrentPlzWeather {
        /** Timestamp of the current weather data. */
        time: number;
        /** The weather icon code representing the current weather. */
        icon: number;
        /** The current temperature in degrees Celsius. */
        temperature: number;
    }

    /**
     * Forecast information for a postal code.
     */
    export interface Forecast {
        /** The date of the forecasted day. */
        dayDate: string;
        /** The weather icon code representing the forecasted day. */
        iconDay: number;
        /** The maximum temperature forecasted for the day in degrees Celsius. */
        temperatureMax: number;
        /** The minimum temperature forecasted for the day in degrees Celsius. */
        temperatureMin: number;
        /** The total precipitation forecasted for the day in millimeters. */
        precipitation: number;
    }

    /**
     * Link information used in warnings.
     */
    export interface Link {
        /** The URL of the link. */
        url: string;
        /** The text description of the link. */
        text: string;
    }

    /**
     * Warning information for a postal code.
     */
    export interface Warning {
        /** The type of the warning. */
        warnType: number;
        /** The level of the warning. */
        warnLevel: number;
        /** The warning text. */
        text: string;
        /** The timestamp from which the warning is valid. */
        validFrom?: number;
        /** The timestamp until which the warning is valid. */
        validTo?: number;
        /** The ordering of the warning. */
        ordering: string;
        /** The HTML formatted warning text. */
        htmlText: string;
        /** Indicates if the warning is only a potential outlook. */
        outlook: boolean;
        /** An array of related links for the warning. */
        links: Link[];
    }

    /**
     * Overview of warning information for a postal code.
     */
    export interface WarningsOverview {
        /** The type of the warning. */
        warnType: number;
        /** The level of the warning. */
        warnLevel: number;
    }

    /**
     * Graph data for a postal code.
     * Includes various weather parameters over time.
     */
    export interface Graph {
        /** Timestamp of the start of the graph data. */
        start: number;
        /** Timestamp of the start of the low resolution graph data. */
        startLowResolution: number;
        /** Precipitation data in 10-minute intervals. */
        precipitation10m: number[];
        /** Weather icon codes in 3-hour intervals. */
        weatherIcon3h: number[];
        /** Extended weather icon codes in 3-hour intervals. */
        weatherIcon3hV2: number[];
        /** Wind direction in 3-hour intervals. */
        windDirection3h: number[];
        /** Wind speed in 3-hour intervals. */
        windSpeed3h: number[];
        /** Sunrise times. */
        sunrise: number[];
        /** Sunset times. */
        sunset: number[];
        /** Minimum temperature in 1-hour intervals. */
        temperatureMin1h: number[];
        /** Maximum temperature in 1-hour intervals. */
        temperatureMax1h: number[];
        /** Mean temperature in 1-hour intervals. */
        temperatureMean1h: number[];
        /** 1-hour precipitation data. */
        precipitation1h: number[];
        /** Minimum precipitation in 1-hour intervals. */
        precipitationMin1h: number[];
        /** Maximum precipitation in 1-hour intervals. */
        precipitationMax1h: number[];
    }

    /**
     * Detailed weather information for a postal code.
     */
    export interface PlzDetail {
        /** The current weather information for the postal code. */
        currentWeather: CurrentPlzWeather;
        /** An array of forecast information for the postal code. */
        forecast?: Forecast[];
        /** An array of active warnings for the postal code. */
        warnings: Warning[];
        /** An array of warning overviews for the postal code. */
        warningsOverview: WarningsOverview[];
        /** The graph data for the postal code. */
        graph?: Graph;
    }

    /**
     * Measurement value with associated timestamp.
     */
    export interface ValueTime {
        /** The measurement value. */
        value: number;
        /** The timestamp of the measurement. */
        timestamp: number;
    }

    /**
     * Various measurements from a weather station.
     */
    export interface StationMeasurements {
        /** Minimum temperature in celsius with timestamp */
        temperatureMin?: ValueTime;
        /** Maximum temperature in celsius with timestamp */
        temperatureMax?: ValueTime;
        /** Total sunshine duration in minutes */
        sunshineTotal?: number;
        /** Total sunshine duration yesterday in minutes */
        sunshineYesterday?: number;
        /** Precipitation in millimeters over the last hour */
        precipitation1H?: number;
        /** Precipitation in millimeters yesterday */
        precipitationYesterday?: number;
        /** Precipitation in millimeters over the last 24 hours */
        precipitation24H?: number;
        /** Precipitation in millimeters over the last 48 hours */
        precipitation48H?: number;
        /** Precipitation in millimeters over the last 72 hours */
        precipitation72H?: number;
        /** Maximum wind gust in km/h with timestamp */
        windGustMax?: ValueTime;
        /** Pressure difference over the last 3 hours */
        pressureDifference3H?: number;
        /** Pressure 850 */
        pressure850?: number;
        /** Pressure 700 */
        pressure700?: number;
        /** Snow depth in centimeters over the last 2 days */
        snow2D?: number;
        /** Snow depth in centimeters over the last 3 days */
        snow3D?: number;
        /** Dew point in celsius */
        dewPoint?: number;
        /** Wind speed in km/h */
        windSpeed?: number;
        /** Precipitation in millimeters */
        precipitation?: number;
        /** Relative humidity in percent */
        humidity?: number;
        /** Pressure at sea level */
        pressureSea?: number;
        /** Standard atmospheric pressure */
        pressureStandard?: number;
        /** Pressure at the station */
        pressureStation?: number;
        /** Wind direction in degrees */
        windDirection?: number;
        /** Wind gust in km/h */
        windGust?: number;
        /** New snow in centimeters */
        snowNew?: number;
        /** Total snow in centimeters */
        snowTotal?: number;
        /** Current temperature in celsius */
        temperature?: number;
        /** Time of the last measurement */
        smnTime?: number;
        /** Total sunshine duration in minutes */
        sunshine?: number;
        /** Time of the last snow measurement */
        snowTime?: number;
        /** Time of the last foehn measurement */
        foehnTime?: number;
        /** Foehn index */
        foehn?: number;
    }

    /**
     * Current weather data from multiple stations.
     */
    export interface CurrentWeather {
        /** Time of the last measurement */
        smnTime: number;
        /** Time of the last foehn measurement */
        foehnTime: number;
        /** Time of the last snow measurement */
        snowTime: number;
        /** Measurements from various weather stations */
        data: Record<string, StationMeasurements>;
    }
}

/**
 * Type definitions for MeteoSwiss SQLite database structure
 */
export namespace Db {
    export type Flag = 0 | 1;
    /**
     * Metadata information stored in the database.
     * There is exactly one row in the metadata table.
     */
    export interface Metadata {
        /** The version of the database file */
        version: string;
    }

    /**
     * Base interface for location data.
     */
    export interface LocationBase {
        /** The X coordinate */
        x: number;
        /** The Y coordinate */
        y: number;
        /** The altitude above sea level in meters */
        altitude: number;
    }

    /**
     * Postal code information.
     */
    export interface Plz extends LocationBase {
        /** Postal code primary key */
        plz_pk: number;
        /** The primary name of the location */
        primary_name: string;
        /** The foreign key for the warning region */
        warnregion: number;
        /** The foreign key for the weather station */
        station: string;
        /** Indicates if the postal code is active */
        active: Flag;
    }

    /**
     * Weather station information.
     */
    export interface Wetterstation extends LocationBase {
        /** Weather station primary key */
        station_pk: string;
        /** The name of the weather station */
        name: string;
        /** The French name of the weather station */
        name_fr: string;
        /** The Italian name of the weather station */
        name_it: string;
        /** The English name of the weather station */
        name_en: string;
        /** The zoom level for map display */
        zoomLevel: number;
        /** Indicates if the weather station supports orientation measurements */
        orientation: Flag;
        /** Indicates if the weather station supports temperature measurements */
        temperature: Flag;
        /** Indicates if the weather station supports sunshine measurements */
        sunshine: Flag;
        /** Indicates if the weather station supports precipitation measurements */
        precipitation: Flag;
        /** Indicates if the weather station supports humidity measurements */
        humidity: Flag;
        /** Indicates if the weather station supports foehn measurements */
        foehn: Flag;
        /** Indicates if the weather station supports wind measurements */
        wind: Flag;
        /** Indicates if the weather station supports snow measurements */
        snow: Flag;
        /** Indicates if the weather station supports pressure measurements */
        pressure: Flag;
        /** Indicates if the weather station supports global radiation measurements */
        globalstrahlung: Flag;
        /** Indicates if the weather station supports hazel pollen measurements */
        hasel: Flag;
        /** Indicates if the weather station supports alder pollen measurements */
        birke: Flag;
        /** Indicates if the weather station supports grass pollen measurements */
        graeser: Flag;
        /** Indicates if the weather station supports ash tree pollen measurements */
        esche: Flag;
        /** Indicates if the weather station supports oak pollen measurements */
        eiche: Flag;
        /** Indicates if the weather station supports beech pollen measurements */
        buche: Flag;
        /** Indicates if the weather station is active */
        active: Flag;
        /** Indicates if the weather station has an image */
        hasImage: Flag;
        /** The timestamp since when temperature measurements are available */
        temperature_since?: number;
        /** The timestamp since when sunshine measurements are available */
        sunshine_since?: number;
        /** The timestamp since when precipitation measurements are available */
        precipitation_since?: number;
        /** The timestamp since when humidity measurements are available */
        humidity_since?: number;
        /** The timestamp since when foehn measurements are available */
        foehn_since?: number;
        /** The timestamp since when wind measurements are available */
        wind_since?: number;
        /** The timestamp since when snow measurements are available */
        snow_since?: number;
        /** The timestamp since when pressure measurements are available */
        pressure_since?: number;
        /** The timestamp since when global radiation measurements are available */
        globalstrahlung_since?: number;
        /** The timestamp since when hazel pollen measurements are available */
        hasel_since?: number;
        /** The timestamp since when alder pollen measurements are available */
        birke_since?: number;
        /** The timestamp since when grass pollen measurements are available */
        graeser_since?: number;
        /** The timestamp since when ash tree pollen measurements are available */
        esche_since?: number;
        /** The timestamp since when oak pollen measurements are available */
        eiche_since?: number;
        /** The timestamp since when beech pollen measurements are available */
        buche_since?: number;
        /** Special notes in German */
        specials_de?: string;
        /** Special notes in French */
        specials_fr?: string;
        /** Special notes in Italian */
        specials_it?: string;
        /** Special notes in English */
        specials_en?: string;
        /** Additional information in German */
        additional_de?: string;
        /** Additional information in French */
        additional_fr?: string;
        /** Additional information in Italian */
        additional_it?: string;
        /** Additional information in English */
        additional_en?: string;
    }
}
