import { selectModel } from '../src/agent/model/select-model.ts';
import { runEvals, summarise } from './harness.ts';

// EVAL_MODEL=real runs the configured provider (OLLAMA_API_KEY etc.); otherwise the worst-case scripted model runs.
const useRealModel = process.env.EVAL_MODEL === 'real';
const results = await runEvals(useRealModel ? { model: selectModel(process.env) } : {});
console.log(`model: ${useRealModel ? 'configured provider' : 'adversarial scripted model'}\n`);
console.log(summarise(results));
const codeFailures = results.filter((result) => result.enforcedBy === 'code' && !result.passed);
process.exit(codeFailures.length > 0 ? 1 : 0);
