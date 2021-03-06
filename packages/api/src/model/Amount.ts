import {AnyNumber} from '@nexex/api/types';
import {utils} from 'ethers';
import {BigNumberish} from 'ethers/utils';

const {formatUnits, parseUnits} = utils;

export enum AmountUnit {
    WEI = 'wei',
    DISPLAY = 'display'
}

export class Amount extends utils.BigNumber {
    decimals: number;

    constructor(value: AnyNumber, decimals: number = 18, unit: AmountUnit = AmountUnit.WEI) {
        if (unit === AmountUnit.DISPLAY) {
            super(parseUnits(String(value), decimals));
        } else {
            super(value);
        }
        this.decimals = decimals;
    }

    toDisplay(): string {
        return formatUnits(this, this.decimals);
    }

    add(other: BigNumberish): Amount {
        const ret = super.add(other);
        return new Amount(ret, this.decimals);
    }
    sub(other: BigNumberish): Amount {
        const ret = super.sub(other);
        return new Amount(ret, this.decimals);
    }
}
