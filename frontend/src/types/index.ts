export type RiskLevel = "conservative" | "moderate" | "aggressive";
export type InvestmentStyle = "day_trading" | "swing" | "long_term";
export type SignalLevel = "weak" | "medium" | "strong" | "very_strong";
export type SuggestionAction = "buy" | "sell" | "hold" | "watch";
export type TransactionType = "buy" | "sell";
export type TransactionStatus = "active" | "closed" | "pending";
export type InstrumentType = "stock" | "call_option" | "put_option";

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  risk_level: RiskLevel;
  investment_style: InvestmentStyle;
  preferred_sectors: string[];
  notifications_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  symbol: string;
  company_name: string | null;
  is_active: boolean;
  notes: string | null;
  added_at: string;
}

export interface Suggestion {
  id: string;
  user_id: string;
  symbol: string;
  signal_level: SignalLevel;
  action: SuggestionAction;
  suggested_buy_price: number | null;
  suggested_sell_price: number | null;
  stop_loss_price: number | null;
  current_price: number | null;
  risk_estimation: string | null;
  reasoning: string;
  technical_summary: TechnicalSummary;
  confidence: number | null;
  time_horizon: string | null;
  notification_sent: boolean;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface TechnicalSummary {
  trend?: string;
  support_levels?: number[];
  resistance_levels?: number[];
  key_indicators?: string;
  bb_upper?: number;
  bb_lower?: number;
  bb_middle?: number;
  sma_20?: number;
  sma_50?: number;
  sma_200?: number;
  rsi?: number;
  macd?: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  symbol: string;
  type: TransactionType;
  status: TransactionStatus;
  instrument_type: InstrumentType;
  quantity: number;        // shares for stocks; shares-equivalent (contracts × 100) for options
  price: number;           // price per share for stocks; premium per share for options
  total_amount: number;
  // Options-only fields (null for stocks)
  strike_price: number | null;
  expiration_date: string | null;
  contracts: number | null;
  notes: string | null;
  suggestion_id: string | null;
  executed_at: string;
  created_at: string;
}

export interface StockDataCache {
  id: string;
  symbol: string;
  data_type: string;
  data: Record<string, unknown>;
  fetched_at: string;
}

// Alpha Vantage API types
export interface StockQuote {
  symbol: string;
  open: number;
  high: number;
  low: number;
  price: number;
  volume: number;
  latestTradingDay: string;
  previousClose: number;
  change: number;
  changePercent: number;
}

export interface StockDailyData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Gemini analysis request/response
export interface AnalysisRequest {
  symbol: string;
  stockData: StockDailyData[];
  quote: StockQuote;
  userPreferences: {
    risk_level: RiskLevel;
    investment_style: InvestmentStyle;
  };
  existingPositions: Transaction[];
}

export interface AnalysisResponse {
  symbol: string;
  signal_level: SignalLevel;
  action: SuggestionAction;
  suggested_buy_price: number | null;
  suggested_sell_price: number | null;
  stop_loss_price: number | null;
  risk_estimation: string;
  reasoning: string;
  technical_summary: TechnicalSummary;
  confidence: number;
  time_horizon: string;
}
