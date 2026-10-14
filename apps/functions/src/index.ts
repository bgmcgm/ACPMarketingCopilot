import { registerWorkerFunctions } from "./worker/functions.js";
import { registerHttpFunctions } from "./http/functions.js";

registerHttpFunctions();
registerWorkerFunctions();
