"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useFirebase } from "@/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, ShieldPlus } from "lucide-react";

export default function SeedAdminPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const { db } = useFirebase();

  const handleSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    if (!db) {
      setError("Firestore is not initialized.");
      setLoading(false);
      return;
    }

    if (!email) {
      setError("Please provide an email.");
      setLoading(false);
      return;
    }

    try {
      const adminUid = "3vhiKfy0L0dtNJNbWV7uaZiC4IZ2";
      const adminRef = doc(db, "users", adminUid);
      
      await setDoc(adminRef, {
        uid: adminUid,
        displayName: "Super Admin",
        email: email,
        platformRole: "superAdmin",
        status: "active",
        createdBy: "system",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSuccess(true);
    } catch (err: any) {
      console.error("Seed error:", err);
      setError(err.message || "Failed to seed admin user.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mx-auto bg-primary w-12 h-12 rounded-xl flex items-center justify-center mb-4">
            <ShieldPlus className="text-white w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold text-center">Seed Super Admin</CardTitle>
          <CardDescription className="text-center">
            Crée le profil Firestore pour l'UID: <span className="font-mono text-primary">3vhiKfy0L0dtNJNbWV7uaZiC4IZ2</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSeed} className="space-y-4">
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
                <AlertDescription>Profil Super Admin créé avec succès !</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email de l'admin</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="admin@hrexample.com" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Création..." : "Initialiser le profil Admin"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
