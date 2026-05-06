"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { LogIn, Loader2, AlertCircle, CheckCircle2, Database } from "lucide-react";
import { useFirebase } from "@/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  
  // Firestore Test State
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  
  const { auth, db } = useFirebase();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    if (!auth || !db) {
      setError("Le service Firebase n'est pas configuré. Veuillez vérifier vos variables d'environnement.");
      setLoading(false);
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      const userDocRef = doc(db, "users", uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        setError("Profil utilisateur non trouvé dans la base de données (users/" + uid + ").");
      } else {
        const userData = userDoc.data();
        if (userData.status !== "active") {
          setError("Ce compte utilisateur est désactivé.");
        } else {
          setSuccess(true);
          console.log("Connexion réussie pour:", userData.email);
        }
      }
    } catch (err: any) {
      console.error("Erreur de connexion:", err);
      let message = "Une erreur est survenue lors de la connexion.";
      if (err.code === "auth/invalid-credential") {
        message = "Identifiants invalides. Vérifiez votre email et mot de passe.";
      } else if (err.code === "auth/too-many-requests") {
        message = "Trop de tentatives. Veuillez réessayer plus tard.";
      } else if (err.message) {
        message = err.message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestFirestore = async () => {
    setTestMessage(null);
    setTestError(null);
    setTestLoading(true);

    if (!db) {
      setTestError("Firestore n'est pas initialisé.");
      setLoading(false);
      return;
    }

    try {
      // 1. Write document
      const testRef = doc(db, "debug", "firestoreConnectionTest");
      await setDoc(testRef, {
        status: "connected",
        createdAt: serverTimestamp(),
      });

      // 2. Read document back
      const snap = await getDoc(testRef);
      if (snap.exists() && snap.data().status === "connected") {
        setTestMessage("Firestore connected successfully");
      } else {
        setTestError("Impossible de vérifier les données après écriture.");
      }
    } catch (err: any) {
      console.error("Firestore Test Error:", err);
      setTestError(err.message || "Erreur de connexion Firestore");
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md shadow-2xl border-none">
        <CardHeader className="space-y-2 text-center pb-8">
          <div className="mx-auto bg-primary w-12 h-12 rounded-xl flex items-center justify-center mb-4">
            <LogIn className="text-white w-6 h-6" />
          </div>
          <CardTitle className="text-3xl font-headline font-bold text-primary">Connexion</CardTitle>
          <CardDescription>Entrez vos identifiants pour accéder à HR Nexus.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Erreur</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="border-green-500 text-green-600 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>Succès</AlertTitle>
                <AlertDescription>Connexion réussie. Redirection en cours...</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Adresse Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="nom@entreprise.com" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-secondary/30"
                disabled={loading || success}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-secondary/30"
                disabled={loading || success}
              />
            </div>
            <Button type="submit" className="w-full h-12 text-md font-semibold" disabled={loading || success}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {loading ? "Chargement..." : "Se connecter"}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Test de diagnostic</span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleTestFirestore} 
                disabled={testLoading}
                className="flex items-center gap-2"
              >
                {testLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
                Test Firestore
              </Button>
            </div>
            
            {testMessage && (
              <Alert className="border-accent text-accent bg-accent/5">
                <CheckCircle2 className="h-4 w-4 text-accent" />
                <AlertDescription className="font-medium">{testMessage}</AlertDescription>
              </Alert>
            )}
            
            {testError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{testError}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <p className="text-center text-xs text-muted-foreground">
            HR Nexus Studio - Gestion Multi-entités
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
