import Link from "next/link";
import {
  TrendingUp,
  Shield,
  Brain,
  Bell,
  BarChart3,
  ArrowRight,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">AIA</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg transition-colors font-medium"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-8 text-sm text-primary">
          <Brain className="h-4 w-4" />
          AI-Powered Investment Analysis
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Smarter Trading
          <br />
          <span className="text-primary">Powered by AI</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Get real-time technical analysis, AI-generated buy/sell signals, and
          automated portfolio monitoring. Remove emotion from your investment
          decisions.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-3 rounded-lg transition-colors font-medium text-lg flex items-center gap-2"
          >
            Start Free <ArrowRight className="h-5 w-5" />
          </Link>
          <Link
            href="/login"
            className="border border-border hover:border-primary/50 px-8 py-3 rounded-lg transition-colors text-lg"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard
            icon={<Brain className="h-8 w-8 text-primary" />}
            title="AI Analysis"
            description="Gemini AI analyzes Bollinger Bands, RSI, MACD, moving averages, and more to generate precise buy/sell signals."
          />
          <FeatureCard
            icon={<Bell className="h-8 w-8 text-primary" />}
            title="Smart Alerts"
            description="Get notified when strong trading opportunities arise. Never miss a key entry or exit point again."
          />
          <FeatureCard
            icon={<BarChart3 className="h-8 w-8 text-primary" />}
            title="Performance Tracking"
            description="Track every suggestion's performance. See your P&L per stock and overall portfolio gains."
          />
          <FeatureCard
            icon={<Shield className="h-8 w-8 text-primary" />}
            title="Risk Management"
            description="Automatic stop-loss recommendations and risk assessments tailored to your investment style."
          />
          <FeatureCard
            icon={<TrendingUp className="h-8 w-8 text-primary" />}
            title="Technical Indicators"
            description="Real-time Bollinger Bands, SMA, RSI, MACD analysis on all your monitored stocks."
          />
          <FeatureCard
            icon={<BarChart3 className="h-8 w-8 text-primary" />}
            title="Portfolio Dashboard"
            description="Beautiful dashboard showing all your positions, suggestions, and market data at a glance."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 text-center text-muted-foreground text-sm">
        <p>
          AIA - Automated Investor Advisor. Not financial advice. Invest at your
          own risk.
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
