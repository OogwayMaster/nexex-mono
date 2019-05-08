import {Inject, Injectable} from '@nestjs/common';
import {
    NewOrderAcceptedEvent,
    NewOrderAcceptedPayload,
    NewOrderOnboardEvent,
    ObEventTypes,
    OrderbookEvent
} from '@nexex/types';
import {EventSource, OrderDelistEvent, OrderUpdateEvent, OrderUpdatePayload} from '@nexex/types/orderbook';
import BigNumber from 'bignumber.js';
import {Subject} from 'rxjs';
import {filter} from 'rxjs/operators';
import {EventsModule} from '../events/events.module';
import logger from '../logger';
import {OrderService} from '../order/order.service';
import {OrderbookService} from './orderbook.service';

@Injectable()
export class ObNewOrderHandler {
    constructor(
        @Inject(EventsModule.EventSubject) private events$: Subject<OrderbookEvent>,
        private orderbookService: OrderbookService,
        private orderService: OrderService
    ) {
        events$
            .pipe(filter(event => event.type === ObEventTypes.NEW_ORDER_ONBOARD))
            .subscribe((event: NewOrderOnboardEvent) => this.handle(event));
    }

    async handle(inputEvent: NewOrderOnboardEvent): Promise<void> {
        await this.orderbookService.whenReady();
        const {payload, source} = inputEvent;
        logger.debug('observice add order');
        if (await this.orderService.orderExists(payload)) {
            logger.warn(`order already exists ${payload.orderHash}`);
            return;
        }
        try {
            const marketId = this.orderbookService.addOrder(payload);
            const event: NewOrderAcceptedEvent = {
                type: ObEventTypes.NEW_ORDER_ACCEPTED,
                payload: {
                    order: payload,
                    marketId
                },
                source: EventSource.SELF
            };
            await this.orderService.insertOrder(payload);
            this.events$.next(event);
            this.events$.next({
                type: ObEventTypes.PEER_EVENT,
                payload: {
                    ...event,
                    source: EventSource.PEER
                }
            });
            if (source === EventSource.SELF) {
                this.events$.next({
                    type: ObEventTypes.IPFS_PUBLISH,
                    payload: {
                        marketId,
                        order: payload.signedOrder
                    }
                });
            }
        } catch (e) {
            logger.error('failed to add order', payload);
            logger.error(e);
        }
    }
}

@Injectable()
export class NewOrderFromPeerHandler {
    constructor(
        @Inject(EventsModule.EventSubject) private events$: Subject<OrderbookEvent>,
        private orderbookService: OrderbookService
    ) {
        events$
            .pipe(filter(event => event.type === ObEventTypes.NEW_ORDER_ACCEPTED && event.source === EventSource.PEER))
            .subscribe((event: NewOrderAcceptedEvent) => this.handle(event.payload));
    }

    async handle(payload: NewOrderAcceptedPayload): Promise<void> {
        await this.orderbookService.whenReady();
        logger.debug('observice add order');
        try {
            const {order} = payload;
            this.orderbookService.addOrder(order);
        } catch (e) {
            logger.error('failed to add order', payload);
            logger.error(e);
        }
    }
}

@Injectable()
export class OrderUpdateHandler {
    constructor(
        @Inject(EventsModule.EventSubject) private events$: Subject<OrderbookEvent>,
        private orderbookService: OrderbookService
    ) {
        events$
            .pipe(filter(event => event.type === ObEventTypes.ORDER_BALANCE_UPDATE))
            .subscribe((event: OrderUpdateEvent) => this.handle(event.payload));
    }

    async handle(payload: OrderUpdatePayload): Promise<void> {
        await this.orderbookService.whenReady();
        logger.debug('observice update order');
        try {
            const {marketId, orderHash, orderSide, baseAmount, quoteAmount, lastUpdate} = payload;
            this.orderbookService.updateBalance(
                marketId,
                orderHash,
                orderSide,
                new BigNumber(baseAmount),
                new BigNumber(quoteAmount),
                lastUpdate
            );
        } catch (e) {
            logger.error('failed to update order', payload);
            logger.error(e);
        }
    }
}

@Injectable()
export class OrderDelistHandler {
    constructor(
        @Inject(EventsModule.EventSubject) private events$: Subject<OrderbookEvent>,
        private orderbookService: OrderbookService
    ) {
        events$
            .pipe(filter(event => event.type === ObEventTypes.ORDER_DELIST))
            .subscribe((event: OrderDelistEvent) => this.handle(event));
    }

    async handle(event: OrderDelistEvent): Promise<void> {
        await this.orderbookService.whenReady();
        logger.debug('observice update order');
        try {
            const {marketId, orderHash, orderSide, baseAmount, quoteAmount, lastUpdate} = event.payload;
            this.orderbookService.delistOrder(marketId, orderHash, orderSide);
        } catch (e) {
            logger.error('failed to remove order');
            logger.error(e);
        }
    }
}