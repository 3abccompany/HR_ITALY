
export type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
  debugLabel?: string;
};

export class FirestorePermissionError extends Error {
  context: SecurityRuleContext;
  constructor(context: SecurityRuleContext) {
    super(`Firestore permission denied: ${context.operation} on ${context.path} (Source: ${context.debugLabel || 'unknown'})`);
    this.name = 'FirestorePermissionError';
    this.context = context;
  }
}
