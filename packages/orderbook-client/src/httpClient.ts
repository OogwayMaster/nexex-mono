import {PlainDexOrder} from '@nexex/types';
import {
    Market,
    MarketConfig,
    NewOrderAcceptedEvent,
    ObEventTypes,
    Orderbook,
    OrderbookOrder,
    OrderbookSlim
} from '@nexex/types/orderbook';
import {OrderbookOrderTpl, OrderbookTpl} from '@nexex/types/tpl/orderbook';
import axios from 'axios';
import {Deserialize} from 'cerialize';
import {OrderbookWsClientConfig} from './';

export class OrderbookRestClient {
    private config: OrderbookWsClientConfig;

    constructor(config: OrderbookWsClientConfig) {
        this.config = config;
    }

    async snapshot(marketId: string, limit?: number): Promise<Orderbook> {
        const res = await axios.get(`${this.config.url}/v1/market/${marketId}`, {
            params: {
                limit,
                minimal: 'false'
            }
        });
        return Deserialize(res.data, OrderbookTpl);
    }

    async marketConfig(marketId: string): Promise<MarketConfig> {
        const res = await axios.get(`${this.config.url}/v1/market/${marketId}/config`);
        return res.data;
    }

    async topOrders(marketId: string, limit?: number): Promise<OrderbookSlim> {
        const res = await axios.get(`${this.config.url}/v1/market/${marketId}`, {
            params: {
                limit,
                minimal: 'true'
            }
        });
        return res.data;
    }

    async placeOrder(order: PlainDexOrder): Promise<void> {
        await axios.post(`${this.config.url}/v1/order`, order);
    }

    async queryOrder(orderHash: string): Promise<OrderbookOrder> {
        const res = await axios.get(`${this.config.url}/v1/order/${orderHash}`);
        const order = Deserialize(res.data, OrderbookOrderTpl);
        return order;
    }

    async markets(): Promise<Market[]> {
        const res = await axios.get(`${this.config.url}/v1/market`);
        return res.data;
    }

    private parse(event) {
        if (event.type === ObEventTypes.NEW_ORDER_ACCEPTED) {
            const {payload} = event as NewOrderAcceptedEvent;
            const order = Deserialize(payload.order, OrderbookOrderTpl);
            return {
                type: event.type,
                payload: {
                    marketId: payload.marketId,
                    order
                }
            };
        }
        return event;
    }

}