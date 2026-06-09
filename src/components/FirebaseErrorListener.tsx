'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { useToast } from '@/hooks/use-toast';
import { FirestorePermissionError } from '@/firebase/errors';

export function FirebaseErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      toast({
        variant: 'destructive',
        title: 'Permission Firestore refusée',
        description: (
          <div className="space-y-1">
            <p>Accès non autorisé aux données.</p>
            <div className="text-[10px] font-mono bg-black/10 p-1 rounded">
              <p>Source: {error.context.debugLabel || 'Inconnue'}</p>
              <p>Path: {error.context.path}</p>
            </div>
          </div>
        ),
      });
    };

    errorEmitter.on('permission-error', handleError);
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, [toast]);

  return null;
}
