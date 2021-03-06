export {OrderbookWsClient} from './wsClient';
export {OrderbookRestClient} from './httpClient';

export interface OrderbookWsClientConfig {
    url: string;
}

export interface OrderbookServerInfo {
    network: string;
}
