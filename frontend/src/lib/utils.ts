import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function getSignalColor(level: string): string {
  switch (level) {
    case "very_strong":
      return "text-emerald-400";
    case "strong":
      return "text-green-400";
    case "medium":
      return "text-yellow-400";
    case "weak":
      return "text-gray-400";
    default:
      return "text-gray-400";
  }
}

export function getSignalBgColor(level: string): string {
  switch (level) {
    case "very_strong":
      return "bg-emerald-500/20 border-emerald-500/30";
    case "strong":
      return "bg-green-500/20 border-green-500/30";
    case "medium":
      return "bg-yellow-500/20 border-yellow-500/30";
    case "weak":
      return "bg-gray-500/20 border-gray-500/30";
    default:
      return "bg-gray-500/20 border-gray-500/30";
  }
}

export function getActionColor(action: string): string {
  switch (action) {
    case "buy":
      return "text-green-400";
    case "sell":
      return "text-red-400";
    case "hold":
      return "text-yellow-400";
    case "watch":
      return "text-blue-400";
    default:
      return "text-gray-400";
  }
}
