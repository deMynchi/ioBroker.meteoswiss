export namespace Rest {
    export interface DbInfo {
        dbVersion: number;
        checksum: string;
        gaiRate: number;
        timestamp: number;
    }

    export interface CurrentPlzWeather {
        time: number;
        icon: number;
        temperature: number;
    }

    export interface Forecast {
        dayDate: string;
        iconDay: number;
        temperatureMax: number;
        temperatureMin: number;
        precipitation: number;
    }

    export interface Link {
        url: string;
        text: string;
    }

    export interface Warning {
        warnType: number;
        warnLevel: number;
        text: string;
        validFrom?: number;
        validTo?: number;
        ordering: string;
        htmlText: string;
        outlook: boolean;
        links: Link[];
    }

    export interface WarningsOverview {
        warnType: number;
        warnLevel: number;
    }

    export interface Graph {
        start: number;
        startLowResolution: number;
        precipitation10m: number[];
        weatherIcon3h: number[];
        windDirection3h: number[];
        windSpeed3h: number[];
        sunrise: number[];
        sunset: number[];
        temperatureMin1h: number[];
        temperatureMax1h: number[];
        temperatureMean1h: number[];
        precipitation1h: number[];
        precipitationMin1h: number[];
        precipitationMax1h: number[];
    }

    export interface PlzDetail {
        currentWeather: CurrentPlzWeather;
        forecast: Forecast[];
        warnings: Warning[];
        warningsOverview: WarningsOverview[];
        graph: Graph;
    }

    export interface ValueTime {
        value: number;
        timestamp: number;
    }

    export interface StationMeasurements {
        temperatureMin?: ValueTime;
        temperatureMax?: ValueTime;
        sunshineTotal?: number;
        sunshineYesterday?: number;
        precipitation1H?: number;
        precipitationYesterday?: number;
        precipitation24H?: number;
        precipitation48H?: number;
        precipitation72H?: number;
        windGustMax?: ValueTime;
        pressureDifference3H?: number;
        pressure850?: number;
        pressure700?: number;
        snow2D?: number;
        snow3D?: number;
        dewPoint?: number;
        windSpeed?: number;
        precipitation?: number;
        humidity?: number;
        pressureSea?: number;
        pressureStandard?: number;
        pressureStation?: number;
        windDirection?: number;
        windGust?: number;
        snowNew?: number;
        snowTotal?: number;
        temperature?: number;
        smnTime?: number;
        sunshine?: number;
        snowTime?: number;
        foehnTime?: number;
        foehn?: number;
    }

    export interface CurrentWeather {
        smnTime: number;
        foehnTime: number;
        snowTime: number;
        data: Record<string, StationMeasurements>;
    }
}

export namespace Db {
    export interface Metadata {
        version: string;
    }

    export interface LocationBase {
        x: number;
        y: number;
        altitude: number;
    }

    export interface Plz extends LocationBase {
        plz_pk: number;
        primary_name: string;
        warnregion: number;
        station: string;
        active: number;
    }

    export interface Wetterstation extends LocationBase {
        station_pk: string;
        name: string;
        zoomLevel: number;
        orientation: number;
        zoomLevel: number;
        orientation: number;
        temperature: number;
        sunshine: number;
        precipitation: number;
        humidity: number;
        foehn: number;
        wind: number;
        snow: number;
        pressure: number;
        active: number;
        hasImage: number;
        temperature_since: ?number;
        sunshine_since: ?number;
        precipitation_since: ?number;
        humidity_since: ?number;
        foehn_since: ?number;
        wind_since: ?number;
        snow_since: ?number;
        pressure_since: ?number;
        specials_de: ?string;
        specials_fr: ?string;
        specials_it: ?string;
        specials_en: ?string;
        additional_de: ?string;
        additional_fr: ?string;
        additional_it: ?string;
        additional_en: ?string;
    }
}
