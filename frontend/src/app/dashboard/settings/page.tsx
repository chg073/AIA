"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Save, User, Shield, Bell } from "lucide-react";
import type { Profile, RiskLevel, InvestmentStyle } from "@/types";

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const fetchProfile = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (data) {
      setProfile(data);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    const { error } = await supabase
      .from("profiles")
      .update({
        name: profile.name,
        phone: profile.phone,
        risk_level: profile.risk_level,
        investment_style: profile.investment_style,
        notifications_enabled: profile.notifications_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      setError(error.message);
    } else {
      setSuccess("Settings saved successfully");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-8 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your profile and investment preferences
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-success/10 border border-success/20 text-success rounded-lg p-3 text-sm">
          {success}
        </div>
      )}

      <form onSubmit={saveProfile} className="space-y-6">
        {/* Profile Section */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Profile</h2>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) =>
                setProfile({ ...profile, name: e.target.value })
              }
              className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full bg-input/50 border border-border rounded-lg px-4 py-2.5 text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Email cannot be changed
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Phone</label>
            <input
              type="tel"
              value={profile.phone || ""}
              onChange={(e) =>
                setProfile({ ...profile, phone: e.target.value || null })
              }
              placeholder="+1234567890"
              className="w-full bg-input border border-border rounded-lg px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
            />
            <p className="text-xs text-muted-foreground mt-1">
              For SMS notifications on very strong signals
            </p>
          </div>
        </div>

        {/* Investment Preferences */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Investment Preferences</h2>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              Risk Level
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  { value: "conservative", label: "Conservative", desc: "Low risk, stable returns" },
                  { value: "moderate", label: "Moderate", desc: "Balanced risk/reward" },
                  { value: "aggressive", label: "Aggressive", desc: "Higher risk, higher potential" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setProfile({
                      ...profile,
                      risk_level: option.value as RiskLevel,
                    })
                  }
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    profile.risk_level === option.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <p className="font-medium text-sm">{option.label}</p>
                  <p className="text-xs mt-0.5 opacity-70">{option.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              Investment Style
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  { value: "day_trading", label: "Day Trading", desc: "Intraday positions" },
                  { value: "swing", label: "Swing Trading", desc: "Days to weeks" },
                  { value: "long_term", label: "Long Term", desc: "Months to years" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setProfile({
                      ...profile,
                      investment_style: option.value as InvestmentStyle,
                    })
                  }
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    profile.investment_style === option.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <p className="font-medium text-sm">{option.label}</p>
                  <p className="text-xs mt-0.5 opacity-70">{option.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Notifications</h2>
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="font-medium">Enable Notifications</p>
              <p className="text-sm text-muted-foreground">
                Get notified when very strong signals are detected
              </p>
            </div>
            <div
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                profile.notifications_enabled
                  ? "bg-primary"
                  : "bg-muted"
              }`}
              onClick={() =>
                setProfile({
                  ...profile,
                  notifications_enabled: !profile.notifications_enabled,
                })
              }
            >
              <div
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  profile.notifications_enabled
                    ? "translate-x-6"
                    : "translate-x-0.5"
                }`}
              />
            </div>
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Settings
        </button>
      </form>
    </div>
  );
}
