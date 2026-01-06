// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            language: string;
            zips: { zip: number }[];
            stations: { id: string }[];
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
