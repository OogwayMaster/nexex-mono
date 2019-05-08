import {Inject, Injectable} from '@nestjs/common';
import {NewOrderAcceptedEvent, ObEventTypes, OrderbookEvent} from '@nexex/types';
import {EventSource, PeerEvent} from '@nexex/types/orderbook';
import {OrderbookOrderTpl} from '@nexex/types/tpl/orderbook';
import {Deserialize, Serialize} from 'cerialize';
import {Subject} from 'rxjs';
import {filter} from 'rxjs/operators';
import Zmq from 'zeromq';
import {ObConfig} from '../global/global.model';
import logger from '../logger';

const TOPIC = 'ob_event';

@Injectable()
export class ZeromqGateway {
    private pubSock: Zmq.Socket;
    private subSock: Zmq.Socket;

    constructor(@Inject('EventSubject') private events$: Subject<OrderbookEvent>, private config: ObConfig) {
        if (!this.config.isAllInOneNode) {
            if (config.zmq.port) {
                this.pubSock = Zmq.socket('pub');
                this.pubSock.bindSync(`tcp://*:${config.zmq.port}`);
                events$
                    .pipe(filter(event => event.type === ObEventTypes.PEER_EVENT))
                    .subscribe((event: PeerEvent<any>) => this.handleOutbound(event.payload));
            }
            if (config.zmq.nodes && config.zmq.nodes.length > 0) {
                this.subSock = Zmq.socket('sub');
                for (const node of config.zmq.nodes) {
                    this.subSock.connect(node);
                }
                this.subSock.subscribe(TOPIC);
                this.subSock.on('message', this.handleInbound.bind(this));
            }
        }
    }

    async handleInbound(topic: Buffer, message: Buffer): Promise<void> {
        if (topic.toString() === TOPIC) {
            const event = JSON.parse(message.toString());
            if (event.type === ObEventTypes.NEW_ORDER_ACCEPTED) {
                logger.debug('zmq: received peers: new order');
                const order = Deserialize(event.payload.order, OrderbookOrderTpl);
                this.events$.next({
                    type: event.type,
                    payload: {
                        marketId: event.payload.marketId,
                        order
                    },
                    source: EventSource.PEER
                });
            }
        }
    }

    async handleOutbound(payload: NewOrderAcceptedEvent): Promise<void> {
        logger.debug('zmq: notify peers: new order');
        this.pubSock.send([TOPIC, JSON.stringify(Serialize(payload))]);
    }
}