import {Inject, Injectable} from '@nestjs/common';
import {Dex, FeeRate, orderUtil} from '@nexex/api';
import {ObEventTypes, OrderbookEvent, OrderbookOrder, OrderSide, PlainDexOrder} from '@nexex/types';
import {Market, OrderAggregate, OrderbookAggregate, OrderSlim} from '@nexex/types/orderbook';
import BigNumber from 'bignumber.js';
import {ethers} from 'ethers';
import {getAddress} from 'ethers/utils';
import R from 'ramda';
import {Subject} from 'rxjs';
import SortedArray from 'sorted-array';
import {EventsModule} from '../events/events.module';
import {ObConfig} from '../global/global.model';
import logger from '../logger';
import {OrderService} from '../order/order.service';
import {bignumberToBignumber} from '../utils/bignumber';
import {localCache} from '../utils/decorators';
import {defer, Defer} from '../utils/defer';
import {fromPlainDexOrder} from '../utils/orderUtil';
import {FailToQueryAvailableVolume, OrderAmountTooSmall, OrderbookNotExist} from './orderbook.error';
import {Orderbook} from './orderbook.types';

type OrderSlimWithPrice = Pick<OrderbookOrder, 'orderHash' | 'price' | 'remainingBaseTokenAmount' | 'remainingQuoteTokenAmount'>;

@Injectable()
export class OrderbookService {
    private ready: Defer<void>;
    private orderbookMap: {[market: string]: Orderbook} = {};

    constructor(
        private orderService: OrderService,
        private dex: Dex,
        private config: ObConfig,
        @Inject(EventsModule.EventSubject) private events$: Subject<OrderbookEvent>
    ) {
        this.ready = defer();
        this.init().catch(this.ready.reject);
    }

    whenReady(): Promise<void> {
        return this.ready.promise;
    }

    /**
     *
     * @param baseTokenAddr
     * @param quoteTokenAddr
     * @throws error
     */
    getOrderbook(baseTokenAddr: string, quoteTokenAddr: string): Orderbook {
        const key = `${baseTokenAddr}-${quoteTokenAddr}`;
        return this.getOrderbookById(key);
    }

    /**
     *
     * @param marketId
     * @throws error
     */
    getOrderbookById(marketId: string): Orderbook {
        return this.orderbookMap[marketId.toLowerCase()];
    }

    getOrderbooks(): Orderbook[] {
        return Object.values(this.orderbookMap);
    }

    @localCache(12 * 60 * 60 * 1000)
    async getMarkets(): Promise<Market[]> {
        await this.whenReady();
        const ret = [];
        for (const marketId of Object.keys(this.orderbookMap)) {
            const [baseAddr, quoteAddr] = marketId.split('-');
            const [base, quote, baseInRegistry = {symbol: undefined}, quoteInRegistry = {symbol: undefined}] = [
                await this.dex.token.getToken(baseAddr),
                await this.dex.token.getToken(quoteAddr),
                await this.dex.tokenRegistry.getTokenMetaData(baseAddr),
                await this.dex.tokenRegistry.getTokenMetaData(quoteAddr)
            ];
            ret.push({
                base: base.token,
                quote: quote.token,
                marketName: `${baseInRegistry.symbol || baseAddr}-${quoteInRegistry.symbol || quoteAddr}`,
                marketId
            });
        }
        return ret;
    }

    /**
     *
     * @param order
     * @throws OrderbookNotExist
     */
    addOrder(order: OrderbookOrder): string {
        const market = this.findOrderMarket(order.signedOrder.makerTokenAddress, order.signedOrder.takerTokenAddress);
        if (order.side === OrderSide.BID) {
            market.bids.insert(order);
        } else {
            market.asks.insert(order);
        }
        return `${market.baseToken.addr.toLowerCase()}-${market.quoteToken.addr.toLowerCase()}`;
    }

    findOrderMarket(makerTokenAddress: string, takerTokenAddress: string): Orderbook {
        for (const market of Object.values(this.orderbookMap)) {
            if (
                (market.baseToken.addr.toLowerCase() === makerTokenAddress.toLowerCase() &&
                    market.quoteToken.addr.toLowerCase() === takerTokenAddress.toLowerCase()) ||
                (market.baseToken.addr.toLowerCase() === takerTokenAddress.toLowerCase() &&
                    market.quoteToken.addr.toLowerCase() === makerTokenAddress.toLowerCase())
            ) {
                return market;
            }
        }
        throw new OrderbookNotExist();
    }

    updateBalance(
        marketId: string,
        orderHash: string,
        side: OrderSide,
        baseAmount: BigNumber,
        quoteAmount: BigNumber,
        lastUpdate: Date
    ) {
        const orderbook = this.getOrderbookById(marketId);
        const orders = side === OrderSide.ASK ? orderbook.asks : orderbook.bids;
        const match = orders.array.find(order => order.orderHash === orderHash);
        if (match) {
            match.remainingBaseTokenAmount = baseAmount;
            match.remainingQuoteTokenAmount = quoteAmount;
            match.lastUpdate = lastUpdate;
        }
    }

    delistOrder(marketId: string, orderHash: string, side: OrderSide) {
        const orderbook = this.getOrderbookById(marketId);
        const orders = side === OrderSide.ASK ? orderbook.asks : orderbook.bids;
        const match = orders.array.find(order => order.orderHash === orderHash);
        if (match) {
            orders.remove(match);
        }
    }

    async validateOrder(plainOrder: PlainDexOrder): Promise<OrderbookOrder> {
        if (!orderUtil.isValidOrder(plainOrder)) {
            throw new Error('Order Validation failed');
        }
        if (this.dex.exchange.getContractAddress().toLowerCase() !== plainOrder.exchangeContractAddress.toLowerCase()) {
            throw new Error('Order Validation failed');
        }
        if (plainOrder.makerFeeRecipient.toLowerCase() !== this.config.marketDefault.makerFeeRecipient.toLowerCase()) {
            throw new Error('Order Validation failed, bad makerFeeRecipient');
        }
        const minMakerFeeRate = FeeRate.from(this.config.marketDefault.minMakerFeeRate);
        if (minMakerFeeRate.lt(plainOrder.makerFeeRate)) {
            throw new Error('require more maker fee rate');
        }
        const market = this.findOrderMarket(plainOrder.makerTokenAddress, plainOrder.takerTokenAddress);
        const order = fromPlainDexOrder(market.baseToken, market.quoteToken, plainOrder);
        try {
            const availableVolume = bignumberToBignumber(await this.dex.exchange.availableVolume(order.signedOrder));
            const {makerTokenAmount, takerTokenAmount} = order.signedOrder;
            const availableMakerVolume = availableVolume
                .times(makerTokenAmount)
                .div(takerTokenAmount)
                .decimalPlaces(0, BigNumber.ROUND_DOWN);
            if (order.side === OrderSide.ASK) {
                order.remainingBaseTokenAmount = availableMakerVolume;
                order.remainingQuoteTokenAmount = availableVolume;
            } else {
                order.remainingBaseTokenAmount = availableVolume;
                order.remainingQuoteTokenAmount = availableMakerVolume;
            }
            order.lastUpdate = new Date();
        } catch (e) {
            logger.error(`failed to fetch availableVolume for incomming order: ${order.orderHash}`);
            logger.error(e);
            throw new FailToQueryAvailableVolume();
        }
        const [minOrderBase, minOrderQuote] = [
            await this.dex.token.parseAmount(order.baseTokenAddress, this.config.marketDefault.minOrderBaseVolume),
            await this.dex.token.parseAmount(order.quoteTokenAddress, this.config.marketDefault.minOrderQuoteVolume)
        ];
        if (minOrderBase.gt(order.remainingBaseTokenAmount.toString(10))) {
            throw new OrderAmountTooSmall(minOrderBase.toString(), order.remainingBaseTokenAmount.toString(10));
        }
        if (minOrderQuote.gt(order.remainingQuoteTokenAmount.toString(10))) {
            throw new OrderAmountTooSmall(minOrderQuote.toString(), order.remainingQuoteTokenAmount.toString(10));
        }

        return order;
    }

    async getSnapshot(marketId: string, limit: number, minimal: boolean) {
        await this.whenReady();
        const [baseAddress, quoteAddress] = marketId.split('-');
        const ob = this.getOrderbook(baseAddress, quoteAddress);
        const fn = minimal
            ? R.compose(
                R.project(['orderHash', 'price', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount']),
                R.slice(0, limit)
            )
            : R.slice(0, limit);
        if (ob) {
            const slicedOb = {
                bids: fn(ob.bids.array),
                asks: fn(ob.asks.array)
            };
            return slicedOb;
        } else {
            throw new Error('Orderbook not found');
        }
    }

    async queryOrderAggregateByPrice(marketId: string, side: OrderSide, price: string | BigNumber, decimals: number): Promise<OrderAggregate> {
        await this.whenReady();
        const [baseAddress, quoteAddress] = marketId.split('-');
        const ob = this.getOrderbook(baseAddress, quoteAddress);
        const orders = side === OrderSide.ASK ? ob.asks.array : ob.bids.array;
        if (new BigNumber(price).decimalPlaces() > decimals) {
            throw new Error('decimals of price does not match decimals passed in');
        }
        const priceFilterFn = side === OrderSide.ASK ? (order: OrderbookOrder): boolean =>
                order.price.decimalPlaces(decimals, BigNumber.ROUND_UP).eq(price) :
            (order: OrderbookOrder): boolean => order.price.decimalPlaces(decimals).eq(price);
        return R.compose(
            (orders: OrderSlimWithPrice[]): OrderAggregate => ({
                price: new BigNumber(price),
                orders: R.project(['orderHash', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount'], orders)
            }),
            R.project<OrderbookOrder, OrderSlimWithPrice>(['orderHash', 'price', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount']),
            R.filter<OrderbookOrder, 'array'>(priceFilterFn)
        )(orders);
    }

    async buildFillUpToTx(marketId: string, side: OrderSide, orderHashs: string[]): Promise<PlainDexOrder[]> {
        await this.whenReady();
        const ob = this.getOrderbookById(marketId);
        const orders = side === OrderSide.ASK ? ob.asks.array : ob.bids.array;
        const ret: PlainDexOrder[] = [];
        for (const orderHash of orderHashs) {
            const match = orders.find(order => order.orderHash === orderHash);
            if (match){
                ret.push(match.signedOrder);
            }
        }
        return ret;
    }

    async topOrders(marketId: string, limit: number, decimals: number = 5): Promise<OrderbookAggregate> {
        await this.whenReady();
        const [baseAddress, quoteAddress] = marketId.split('-');
        const ob = this.getOrderbook(baseAddress, quoteAddress);
        return {
            bids: this.topBidOrders(ob.bids.array, limit, decimals),
            asks: this.topAskOrders(ob.asks.array, limit, decimals),
            baseToken: baseAddress,
            quoteToken: quoteAddress
        }

    }

    /**
     * 1) get market list from config
     * 2) load orders of each market from db
     * 3) register listener of ipfs for each market
     */
    protected async init(): Promise<void> {
        logger.info('OrderbookService#init: start');
        const length = this.config.markets.length;
        for (let idx = 0; idx < length; idx++) {
            const marketSymbol = this.config.markets[idx];
            logger.info('OrderbookService#init: %d/%d %s', idx + 1, length, marketSymbol);
            const [baseName, quoteName] = marketSymbol.split('-');
            try {
                const [baseAddress, quoteAddress] = await Promise.all([
                    this.getTokenAddress(baseName),
                    this.getTokenAddress(quoteName)
                ]);
                const baseTokenAddrNormalized = baseAddress.toLowerCase();
                const quoteTokenAddrNormalized = quoteAddress.toLowerCase();
                const marketId = `${baseTokenAddrNormalized}-${quoteTokenAddrNormalized}`;
                // step 2)
                const ob = await this.loadOrderbook(baseTokenAddrNormalized, quoteTokenAddrNormalized);
                this.orderbookMap[marketId] = ob;

                // step 3)
                this.events$.next({
                    type: ObEventTypes.IPFS_SUBSCRIPTION,
                    payload: {
                        marketId
                    }
                });
            } catch (e) {
                logger.error('OrderbookService#init: %s failed', marketSymbol);
                logger.error(e.stack);
            }
        }
        this.ready.resolve();
        logger.info('OrderbookService#init: complete');
    }

    // price round down for bids, round up for asks
    private topBidOrders(orders: OrderbookOrder[], limit: number, decimals: number) {
        const state: {count: number, price: BigNumber} = {count: 0, price: undefined};
        const takeLimitOrderFn = R.takeWhile<OrderbookOrder>((order) => {
            const price = order.price.decimalPlaces(decimals);
            if (!state.price || !price.eq(state.price)) {
                state.count++;
                state.price = price;
            }
            return state.count <= limit;
        });
        return R.compose(
            R.map<OrderSlim[], OrderAggregate>((orders: OrderSlimWithPrice[]): OrderAggregate => {
                return {
                    orders: R.project<OrderSlimWithPrice, OrderSlim>(['orderHash', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount'], orders),
                    price: orders[0].price.decimalPlaces(decimals)
                };
            }),
            R.groupWith<OrderSlimWithPrice>((left, right) => left.price.decimalPlaces(decimals).eq(right.price.decimalPlaces(decimals))),
            R.project(['orderHash', 'price', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount']),
            takeLimitOrderFn
        )(orders);
    }

    // price round down for bids, round up for asks
    private topAskOrders(orders: OrderbookOrder[], limit: number, decimals: number) {
        const state: {count: number, price: BigNumber} = {count: 0, price: undefined};
        const takeLimitOrderFn = R.takeWhile<OrderbookOrder>((order) => {
            const price = order.price.decimalPlaces(decimals, BigNumber.ROUND_UP);
            if (!state.price || !price.eq(state.price)) {
                state.count++;
                state.price = price;
            }
            return state.count <= limit;
        });
        return R.compose(
            R.map<OrderSlim[], OrderAggregate>((orders: OrderSlimWithPrice[]): OrderAggregate => {
                // const [aggregateBaseTokenAmount, aggregateQuoteTokenAmount] =
                //     orders.reduce(([acc1, acc2], order) =>
                //             [acc1.plus(order.remainingBaseTokenAmount), acc2.plus(order.remainingQuoteTokenAmount)]
                //         , [new BigNumber(0), new BigNumber(0)]);
                return {
                    orders: R.project<OrderSlimWithPrice, OrderSlim>(['orderHash', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount'], orders),
                    price: orders[0].price.decimalPlaces(decimals)
                };
            }),
            R.groupWith<OrderSlimWithPrice>((left, right) => left.price.decimalPlaces(decimals).eq(right.price.decimalPlaces(decimals))),
            R.project(['orderHash', 'price', 'remainingBaseTokenAmount', 'remainingQuoteTokenAmount']),
            takeLimitOrderFn
        )(orders);
    }

    private async loadOrderbook(baseTokenAddress: string, quoteTokenAddress: string): Promise<Orderbook> {
        const [bids, asks] = [
            await this.orderService.loadOrders(baseTokenAddress, quoteTokenAddress, OrderSide.BID),
            await this.orderService.loadOrders(baseTokenAddress, quoteTokenAddress, OrderSide.ASK)
        ];
        const [baseTokenContract, quoteTokenContract] = [
            await this.dex.token.getToken(baseTokenAddress),
            await this.dex.token.getToken(quoteTokenAddress)
        ];
        const sortedBids = new SortedArray(bids, (a, b) =>
            a.price
                .minus(b.price)
                .negated()
                .toNumber()
        );
        const sortedAsks = new SortedArray(asks, (a, b) => a.price.minus(b.price).toNumber());
        return {
            baseToken: baseTokenContract.token,
            quoteToken: quoteTokenContract.token,
            bids: sortedBids,
            asks: sortedAsks
        };
    }

    private async getTokenAddress(nameOrAddress: string): Promise<string> {
        if (ethers.utils.isHexString(nameOrAddress)) {
            return getAddress(nameOrAddress);
        }
        return this.dex.tokenRegistry.getTokenAddressBySymbol(nameOrAddress);
    }
}
