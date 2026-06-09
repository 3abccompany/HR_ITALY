'use client';

import { useEffect, useState } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '../errors';

export function useDoc<T = DocumentData>(
  ref: DocumentReference<T> | null,
  debugLabel?: string
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const label = debugLabel || "UNKNOWN_CALLER";

  useEffect(() => {
    if (!ref) {
      setLoading(false);
      setData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const unsubscribe = onSnapshot(
      ref,
      (snapshot: DocumentSnapshot<T>) => {
        if (!isMounted) return;
        setData(snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as T) : null);
        setLoading(false);
        setError(null);
      },
      async (err: any) => {
        if (!isMounted) return;
        
        if (err.code === 'permission-denied') {
          console.error(`[Firestore:PermissionDenied] Source: ${label} | Path: ${ref.path}`, {
            error: err,
            ref: ref,
            pathname: typeof window !== 'undefined' ? window.location.pathname : 'server'
          });
          console.trace();

          const permissionError = new FirestorePermissionError({
            path: ref.path,
            operation: 'get',
            debugLabel: label,
          } satisfies SecurityRuleContext);

          errorEmitter.emit('permission-error', permissionError);
        } else if (err.code === 'failed-precondition') {
          console.warn(`[Firestore:FailedPrecondition] Source: ${label} | Path: ${ref.path}`, err);
        } else {
          console.error(`[Firestore:Error] Source: ${label} | Code: ${err.code} | Path: ${ref.path}`, err);
        }

        setError(err);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [ref, label]);

  return { data, loading, error };
}
