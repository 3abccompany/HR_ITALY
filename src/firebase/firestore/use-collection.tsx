'use client';

import { useEffect, useState } from 'react';
import {
  Query,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '../errors';

export function useCollection<T = DocumentData>(
  query: Query<any> | CollectionReference<any> | null,
  debugLabel?: string
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const label = debugLabel || "UNKNOWN_CALLER";

  useEffect(() => {
    if (!query) {
      setLoading(false);
      setData([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const unsubscribe = onSnapshot(
      query,
      (snapshot: QuerySnapshot<any>) => {
        if (!isMounted) return;
        setData(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as T)));
        setLoading(false);
        setError(null);
      },
      async (err) => {
        if (!isMounted) return;
        
        const path = (query as any)._query?.path?.toString() || 'unknown';
        
        if (err.code === 'permission-denied') {
          console.error(`[Firestore:PermissionDenied] Source: ${label} | Path: ${path}`, {
            error: err,
            query: query,
            pathname: typeof window !== 'undefined' ? window.location.pathname : 'server'
          });
          console.trace();
        }
        
        const permissionError = new FirestorePermissionError({
          path,
          operation: 'list',
          debugLabel: label,
        } satisfies SecurityRuleContext);

        errorEmitter.emit('permission-error', permissionError);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [query, label]);

  return { data, loading, error };
}
