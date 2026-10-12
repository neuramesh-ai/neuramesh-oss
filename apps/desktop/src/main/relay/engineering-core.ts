import type { ClineCore } from '@cline/sdk';
import { ENGINEERING_CLINE_TOOL_POLICIES } from '../../engineering-protocol';
import type { EngineeringProviderResolution } from './engineering-provider';
import { engineeringProviderFetch } from './engineering-provider-stream';

type CoreOptions = NonNullable<Parameters<typeof ClineCore.create>[0]>;
/** Both initial sessions and model handoffs use the same stream guards and tool policies. */
export function engineeringCoreOptions(provider: EngineeringProviderResolution, threadId: string,
  capabilities: CoreOptions['capabilities'], record: (type: string, payload: unknown) => void, log: (line: string) => void): CoreOptions {
  return {
    clientName: 'neuramesh-engineering', backendMode: 'local',
    fetch: engineeringProviderFetch(provider.runtimeFetch ?? fetch, receipt => {
      record('provider.stream', { provider: provider.providerId, model: provider.modelId, ...receipt });
      log(`engineering_provider_stream thread=${threadId} ${JSON.stringify(receipt)}`);
    }),
    capabilities, toolPolicies: ENGINEERING_CLINE_TOOL_POLICIES,
  };
}
