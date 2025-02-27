import Serverless, { FunctionDefinition } from 'serverless';
import ServerlessPlugin from 'serverless/classes/Plugin';

import { Trigger } from '../entities/trigger';
import { YandexCloudProvider } from '../provider/provider';
import { logger } from '../utils/logger';
import {
    FunctionInfo, MessageQueueInfo, S3BucketInfo, ServiceAccountInfo, TriggerInfo,
} from '../types/common';

export class YandexCloudInfo implements ServerlessPlugin {
    private readonly serverless: Serverless;
    private readonly options: Serverless.Options;

    private provider: YandexCloudProvider;
    private existingQueues: MessageQueueInfo[] | undefined = undefined;
    private existingBuckets: S3BucketInfo[] | undefined = undefined;

    hooks: ServerlessPlugin.Hooks;

    constructor(serverless: Serverless, options: Serverless.Options) {
        this.serverless = serverless;
        this.options = options;
        this.provider = this.serverless.getProvider('yandex-cloud') as YandexCloudProvider;

        this.hooks = {
            'info:info': async () => {
                try {
                    await this.info();
                } catch (error) {
                    logger.error(error);

                    this.serverless.cli.log('Failed to get state');
                }
            },
        };
    }

    serviceAccountInfo(name: string, params: unknown, currentAccounts: ServiceAccountInfo[]) {
        const acc = currentAccounts.find((item) => item.name === name);

        if (acc) {
            this.serverless.cli.log(`Service account "${name}" created with id "${acc.id}"`);
        } else {
            this.serverless.cli.log(`Service account "${name}" not created`);
        }
    }

    messageQueueInfo(name: string, params: unknown, currentQueues: MessageQueueInfo[]) {
        const queue = currentQueues.find((item) => item.name === name);

        if (queue) {
            this.serverless.cli.log(`Message queue "${name}" created with id "${queue.id}"`);
        } else {
            this.serverless.cli.log(`Message queue "${name}" not created`);
        }
    }

    objectStorageInfo(name: string, params: unknown, currentBuckets: S3BucketInfo[]) {
        const bucket = currentBuckets.find((item) => item.name === name);

        if (bucket) {
            this.serverless.cli.log(`Object storage bucket "${name}" created`);
        } else {
            this.serverless.cli.log(`Object storage bucket "${name}" not created`);
        }
    }

    triggersInfo(func: string, params: FunctionDefinition, currentTriggers: TriggerInfo[]) {
        for (const event of Object.values(params.events || [])) {
            const normalized = Trigger.normalizeEvent(event);

            if (!normalized) {
                continue;
            }

            const triggerName = `${params.name}-${normalized.type}`;
            const trigger = currentTriggers.find((item) => item.name === triggerName);

            if (trigger) {
                this.serverless.cli.log(`Trigger "${triggerName}" for function "${func}" deployed with id "${trigger.id}"`);
            } else {
                this.serverless.cli.log(`Trigger "${triggerName}" for function "${func}" not deployed`);
            }
        }
    }

    functionInfo(name: string, params: FunctionDefinition, currentFunctions: FunctionInfo[], currentTriggers: TriggerInfo[]) {
        const func = currentFunctions.find((currFunc) => currFunc.name === params.name);

        if (func) {
            this.serverless.cli.log(`Function "${name}" deployed with id "${func.id}"`);
            this.triggersInfo(name, params, currentTriggers);
        } else {
            this.serverless.cli.log(`Function "${name}" not deployed`);
        }
    }
    async getMessageQueuesCached() {
        if (!this.existingQueues) {
            this.existingQueues = await this.provider.getMessageQueues();
        }

        return this.existingQueues;
    }

    async getS3BucketsCached() {
        if (!this.existingBuckets) {
            this.existingBuckets = await this.provider.getS3Buckets();
        }

        return this.existingBuckets;
    }

    async info() {
        const currentFunctions = await this.provider.getFunctions();
        const currentTriggers = await this.provider.getTriggers();
        const currentServiceAccounts = await this.provider.getServiceAccounts();

        for (const [key, value] of Object.entries(this.serverless.service.functions || [])) {
            this.functionInfo(key, value, currentFunctions, currentTriggers);
        }

        for (const [key, value] of Object.entries(this.serverless.service.resources || [])) {
            try {
                // eslint-disable-next-line default-case
                switch (value.type) {
                    case 'yc::MessageQueue':
                        this.messageQueueInfo(key, value, await this.getMessageQueuesCached());
                        break;
                    case 'yc::ObjectStorageBucket':
                        this.objectStorageInfo(key, value, await this.getS3BucketsCached());
                        break;
                }
            } catch (error) {
                this.serverless.cli.log(`Failed to get state for "${key}"
        ${error}
        Maybe you should set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY environment variables`);
            }
        }

        for (const [key, value] of Object.entries(this.serverless.service.resources || [])) {
            if (value.type === 'yc::ServiceAccount') {
                this.serviceAccountInfo(key, value, currentServiceAccounts);
            }
        }
    }
}
