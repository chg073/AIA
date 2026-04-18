import Link from "next/link";
import { TrendingUp, ShieldX } from "lucide-react";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-6">
          <TrendingUp className="h-8 w-8 text-primary" />
          <span className="text-2xl font-bold">AIA</span>
        </Link>

        <div className="bg-card border border-border rounded-xl p-8">
          <ShieldX className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Registration Closed</h1>
          <p className="text-muted-foreground">
            New account registration is currently disabled. If you already have
            an account, please sign in below.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-block mt-6 bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2.5 px-6 rounded-lg transition-colors"
        >
          Go to Sign In
        </Link>
      </div>
    </div>
  );
}
