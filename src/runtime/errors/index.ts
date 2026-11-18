// Public application facade. Internal classification, storage, and logging APIs stay private.
export { clientError } from "../../core/errors";
export type {
  ClientErrorCode,
  OperationKey,
  OperationOutcome,
  PublicContext,
} from "../../core/errors";
export {
  captureOperationError,
  installGlobalErrorHandlers,
  invokeCommand,
  runBackgroundOperation,
  runOperation,
} from "./runtime";
