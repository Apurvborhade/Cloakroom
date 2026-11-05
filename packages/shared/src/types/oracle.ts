export interface PriceReport {
  pair: string;
  price: bigint; // 1e18 fixed point
  ts: number;
  source: string;
}
