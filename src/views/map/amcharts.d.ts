/* amCharts5 + geodata are loaded from the CDN as globals. We only need loose
   typings to call them; `any` keeps us out of maintaining full amCharts types. */
declare const am5: any;
declare const am5map: any;
declare const am5themes_Animated: any;
declare const am5geodata_worldLow: any;

interface Window {
  am5?: any;
  am5map?: any;
  am5themes_Animated?: any;
  am5geodata_worldLow?: any;
  [key: string]: any;
}
