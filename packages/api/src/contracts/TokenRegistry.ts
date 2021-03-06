import {Artifact, TokenMetaData} from '@nexex/types';
import {Signer, utils} from 'ethers';
import {TransactionRequest, TransactionResponse} from 'ethers/providers';
import {artifacts} from '../artifacts';
import {constants} from '../constants';
import * as decorators from '../decorators';
import {assert} from '../utils/assert';
import {OwnableContract} from './OwnableContract';

const {getAddress} = utils;

export class TokenRegistry extends OwnableContract {
    @decorators.validate
    async addToken(
        signer: Signer,
        @decorators.validators.ethAddressHex tokenAddr: string,
        symbol: string,
        name: string,
        decimals: number,
        ipfsHash: string,
        swarmHash: string,
        opt: TransactionRequest = {}
    ): Promise<TransactionResponse> {
        const [signerAddr, token, owner, tokenAddrByName, tokenAddrBySymbol] = [
            await signer.getAddress(),
            await this.getTokenMetaData(tokenAddr),
            await this.owner(),
            await this.getTokenAddressByName(name),
            await this.getTokenAddressBySymbol(symbol)
        ];
        assert.notExists(token);
        assert.notExists(tokenAddrByName);
        assert.notExists(tokenAddrBySymbol);
        assert.assert(getAddress(signerAddr) === owner, 'only owner can add token');

        return this.contract.connect(signer).addToken(tokenAddr, name, symbol, decimals, ipfsHash, swarmHash, opt);
    }

    @decorators.validate
    async removeToken(
        signer: Signer,
        @decorators.validators.ethAddressHex tokenAddr: string,
        opt: TransactionRequest = {}
    ): Promise<TransactionResponse> {
        const [signerAddr, owner, tokens] = [
            await signer.getAddress(),
            await this.owner(),
            await this.getTokenAddresses()
        ];
        const tokenIdx = tokens.findIndex(addr => addr === tokenAddr);
        assert.exists(tokenIdx >= 0);
        assert.assert(getAddress(signerAddr) === owner, 'only owner can remove token');
        return this.contract.connect(signer).removeToken(tokenAddr, tokenIdx, opt);
    }

    @decorators.validate
    async setTokenName(
        signer: Signer,
        @decorators.validators.ethAddressHex tokenAddr: string,
        name: string,
        opt: TransactionRequest = {}
    ): Promise<TransactionResponse> {
        assert.exists(name);
        const [token, tokenAddrByName] = [
            await this.getTokenMetaData(tokenAddr),
            await this.getTokenAddressByName(name)
        ];
        assert.exists(token);
        assert.notExists(tokenAddrByName);

        return this.contract.connect(signer).setTokenName(tokenAddr, name, opt);
    }

    @decorators.validate
    async setTokenSymbol(
        signer: Signer,
        @decorators.validators.ethAddressHex tokenAddr: string,
        symbol: string,
        opt: TransactionRequest = {}
    ): Promise<TransactionResponse> {
        assert.exists(symbol);
        const [token, tokenAddrBySymbol] = [
            await this.getTokenMetaData(tokenAddr),
            await this.getTokenAddressBySymbol(symbol)
        ];
        assert.exists(token);
        assert.notExists(tokenAddrBySymbol);

        return this.contract.connect(signer).setTokenSymbol(tokenAddr, symbol, opt);
    }

    @decorators.validate
    async setTokenIpfsHash(
        signer: Signer,
        @decorators.validators.ethAddressHex tokenAddr: string,
        ipfsHash: string,
        opt: TransactionRequest = {}
    ): Promise<TransactionResponse> {
        const token = await this.getTokenMetaData(tokenAddr);
        assert.exists(token);
        assert.exists(ipfsHash);

        return this.contract.connect(signer).setTokenIpfsHash(tokenAddr, ipfsHash, opt);
    }

    @decorators.validate
    async setTokenSwarmHash(
        signer: Signer,
        @decorators.validators.ethAddressHex tokenAddr: string,
        swarmHash: string,
        opt: TransactionRequest = {}
    ): Promise<TransactionResponse> {
        const token = await this.getTokenMetaData(tokenAddr);
        assert.exists(token);
        assert.exists(swarmHash);

        return this.contract.connect(signer).setTokenSwarmHash(tokenAddr, swarmHash, opt);
    }

    /* call functions */
    async getTokenAddressBySymbol(symbol: string): Promise<string> {
        const tokenAddr = await this.contract.getTokenAddressBySymbol(symbol);

        return tokenAddr === constants.NULL_ADDRESS ? null : tokenAddr;
    }

    async getTokenAddressByName(name: string): Promise<string> {
        const tokenAddr = await this.contract.getTokenAddressByName(name);

        return tokenAddr === constants.NULL_ADDRESS ? null : tokenAddr;
    }

    @decorators.validate
    async getTokenMetaData(@decorators.validators.ethAddressHex tokenAddr: string): Promise<TokenMetaData> {
        const result: any[] = await this.contract.getTokenMetaData(tokenAddr);
        if (result[0] === constants.NULL_ADDRESS) {
            return undefined;
        } else {
            return {
                addr: result[0],
                name: result[1],
                symbol: result[2],
                decimals: Number(result[3]),
                ipfsHash: result[4],
                swarmHash: result[5]
            };
        }
    }

    async getTokenByName(name: string): Promise<TokenMetaData> {
        const result: any[] = await this.contract.getTokenByName(name);
        if (result[0] === constants.NULL_ADDRESS) {
            return undefined;
        } else {
            return {
                addr: result[0],
                name: result[1],
                symbol: result[2],
                decimals: Number(result[3]),
                ipfsHash: result[4],
                swarmHash: result[5]
            };
        }
    }

    async getTokenBySymbol(symbol: string): Promise<TokenMetaData> {
        const result: any[] = await this.contract.getTokenBySymbol(symbol);
        if (result[0] === constants.NULL_ADDRESS) {
            return undefined;
        } else {
            return {
                addr: result[0],
                name: result[1],
                symbol: result[2],
                decimals: Number(result[3]),
                ipfsHash: result[4],
                swarmHash: result[5]
            };
        }
    }

    async getTokenAddresses(): Promise<string[]> {
        return this.contract.getTokenAddresses();
    }

    protected getArtifact(): Artifact {
        return artifacts.TokenRegistryArtifact;
    }
}
