/* ==========================================================================
   On the Road · Static safety data — country level
   --------------------------------------------------------------------------
   Human-verified emergency numbers and city-agnostic safety info.
   Embassy data is nationality-dependent → always AI-generated.
   Hospital addresses are city-specific → always AI-generated.

   Emergency numbers sourced from official government / EU sources.
   Last reviewed: 2025-06.
   To add a country: copy an existing entry and verify numbers at
     https://en.wikipedia.org/wiki/Emergency_telephone_number
   ========================================================================== */

import type { GeneratedSafety } from '../../views/safety/generate.ts';

type StaticCountry = Omit<
  GeneratedSafety,
  'city' | 'country' | 'embassy' | 'hospitals'
>;

const EMPTY_EMBASSY: GeneratedSafety['embassy'] = {
  nationality: '',
  name: '',
  address: '',
  phone: '',
  website: '',
};

/* ── Data ────────────────────────────────────────────────────────────────── */

const COUNTRIES: Record<string, StaticCountry> = {
  Denmark: {
    flag: '🇩🇰',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police (non-emergency)', number: '114' },
      { label: 'Ambulance', number: '112' },
      { label: 'Fire', number: '112' },
      { label: "Women's helpline", number: '1888' },
    ],
    trustedTransport: [
      'Uber and Bolt both operate in Copenhagen; taxis are metered and reliable',
      'At night take a front seat in taxis or sit near the driver on public transit',
    ],
    areasToAvoid: [
      'Christiania after dark — the open drug market makes it riskier for solo women',
      'Central Station surroundings late at night',
    ],
    commonScams: [
      'Distraction theft on the metro — keep your bag in front of you',
      'Overpriced "tourist menus" near Nyhavn — check prices before sitting',
    ],
    phrases: [
      { en: 'Help', local: 'Hjælp', pronunciation: 'yelp' },
      { en: 'Call the police', local: 'Ring til politiet', pronunciation: 'ring teel poli-tee-et' },
      { en: 'I need a doctor', local: 'Jeg har brug for en læge', pronunciation: 'yai har broo for en lay-eh' },
      { en: 'Leave me alone', local: 'Lad mig være i fred', pronunciation: 'lath my vare ee freth' },
    ],
    womenTips: [
      'Denmark is one of the safest countries in Europe for solo women travellers',
      'Cycling is the main transport — helmet rentals are widely available',
      'Bars close at 05:00; night buses run well — check Rejseplanen app for routes',
      'Save the Women\'s Crisis Centre number (1888) before you go out at night',
    ],
  },

  Germany: {
    flag: '🇩🇪',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '110' },
      { label: 'Ambulance / Fire', number: '112' },
      { label: "Women's helpline", number: '08000 116 016' },
    ],
    trustedTransport: [
      'Uber, FreeNow, and Bolt operate in major cities; taxis are metered',
      'U-Bahn and S-Bahn are safe; avoid empty carriages late at night',
    ],
    areasToAvoid: [
      'Kottbusser Tor (Berlin) late at night — petty crime and drug dealing',
      'Central stations in large cities after midnight — stay alert to your surroundings',
    ],
    commonScams: [
      'Fake charity clipboards — sign nothing and give nothing',
      'Distraction pickpockets on crowded U-Bahn platforms',
      'Overpriced taxi rides from airports — use the DB app or a meter taxi',
    ],
    phrases: [
      { en: 'Help', local: 'Hilfe', pronunciation: 'hil-feh' },
      { en: 'Call the police', local: 'Rufen Sie die Polizei', pronunciation: 'roo-fen zee dee poli-tsai' },
      { en: 'I need a doctor', local: 'Ich brauche einen Arzt', pronunciation: 'ikh brau-kheh eye-nen artst' },
      { en: 'Leave me alone', local: 'Lassen Sie mich in Ruhe', pronunciation: 'las-sen zee mikh in roo-eh' },
    ],
    womenTips: [
      'Germany has a national women\'s helpline (08000 116 016) free 24/7 in many languages',
      'Solo travel is very common and generally safe; trust your gut in unfamiliar areas',
      'Keep a copy of your passport in your hotel; police may ask for ID',
      'Download the Nina warning app for official emergency alerts',
    ],
  },

  Netherlands: {
    flag: '🇳🇱',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police (non-emergency)', number: '0900 8844' },
      { label: 'Ambulance', number: '112' },
      { label: 'Fire', number: '112' },
      { label: "Women's helpline (Veilig Thuis)", number: '0800 2000' },
    ],
    trustedTransport: [
      'Uber and Bolt work in Amsterdam; taxis (taxameter) are reliable',
      'Night buses (Nachtbus) run in Amsterdam on weekends — use the GVB app',
      'Cycling is normal — rent from Swapfiets or MacBike for day trips',
    ],
    areasToAvoid: [
      'Red Light District late at night — high foot traffic and opportunistic theft',
      'Centraal Station surroundings after midnight',
    ],
    commonScams: [
      'Fake "tour guides" near museums offering unsolicited help',
      'Distraction theft on trams — keep bags in front',
      'Unlicensed boat tours — book only through recognised operators',
    ],
    phrases: [
      { en: 'Help', local: 'Help', pronunciation: 'help' },
      { en: 'Call the police', local: 'Bel de politie', pronunciation: 'bel deh poli-see' },
      { en: 'I need a doctor', local: 'Ik heb een dokter nodig', pronunciation: 'ik hep en dok-ter noh-dikh' },
      { en: 'Leave me alone', local: 'Laat me met rust', pronunciation: 'laht meh met rust' },
    ],
    womenTips: [
      'Amsterdam is very solo-travel friendly; most locals speak excellent English',
      'Cycling paths are for cyclists — walk on pavements to avoid collisions',
      'The coffeeshop culture is tourist-facing; you\'re never obliged to participate',
      'Register your travel with your embassy if staying longer than a week',
    ],
  },

  Belgium: {
    flag: '🇧🇪',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '101' },
      { label: 'Ambulance', number: '100' },
      { label: 'Fire', number: '100' },
      { label: "Women's helpline", number: '0800 30 030' },
    ],
    trustedTransport: [
      'Uber and Bolt operate in Brussels; licensed taxis have a meter',
      'Metro and trams are generally safe; be alert on Line 2/6 late at night',
    ],
    areasToAvoid: [
      'Molenbeek district late at night — higher petty crime rate',
      'North Station (Gare du Nord) surroundings after dark',
    ],
    commonScams: [
      'Pickpockets on the Grand Place and Atomium — tourist hotspots are targets',
      'Overpriced waffles at "tourist" stands — go one street back for better prices',
    ],
    phrases: [
      { en: 'Help', local: 'Au secours / Help', pronunciation: 'oh se-koor / help' },
      { en: 'Call the police', local: 'Appelez la police', pronunciation: 'a-play la poh-lees' },
      { en: 'I need a doctor', local: "J'ai besoin d'un médecin", pronunciation: 'zhay be-zwan dun may-de-san' },
      { en: 'Leave me alone', local: 'Laissez-moi tranquille', pronunciation: 'lay-say mwa tran-keel' },
    ],
    womenTips: [
      'Belgium is generally safe; Brussels city centre is busy and well-lit at night',
      'Carry a transit card (MOBIB) — contactless works on all Brussels transit',
      'The national women\'s helpline (0800 30 030) is free 24/7',
      'Ghent and Bruges are quieter, very safe cities for solo exploration',
    ],
  },

  France: {
    flag: '🇫🇷',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '17' },
      { label: 'Ambulance (SAMU)', number: '15' },
      { label: 'Fire (Pompiers)', number: '18' },
      { label: "Women's helpline", number: '3919' },
    ],
    trustedTransport: [
      'Uber, Bolt, and Kapten operate in Paris; licensed G7 taxis have a meter',
      'RER and Metro are safe; avoid empty carriages on RER B late at night',
      'Noctilien night buses run midnight–05:30 across Paris',
    ],
    areasToAvoid: [
      'Château Rouge (18th) and Barbès late at night',
      'Around Gare du Nord after midnight — stay alert',
      'Bois de Boulogne at night',
    ],
    commonScams: [
      '"Gold ring" scam near the Eiffel Tower — someone "finds" a ring and asks for money',
      'Petition / clipboard scam at major tourist sites — sign nothing',
      'Distraction theft on the Metro — especially lines 1, 2, and RER B',
    ],
    phrases: [
      { en: 'Help', local: 'Au secours', pronunciation: 'oh se-koor' },
      { en: 'Call the police', local: 'Appelez la police', pronunciation: 'a-play la poh-lees' },
      { en: 'I need a doctor', local: "J'ai besoin d'un médecin", pronunciation: 'zhay be-zwan dun may-de-san' },
      { en: 'Leave me alone', local: 'Laissez-moi tranquille', pronunciation: 'lay-say mwa tran-keel' },
    ],
    womenTips: [
      'Street harassment (outrage sexiste) is a criminal offence in France since 2018',
      'The 3919 helpline for women is free and confidential, available 24/7',
      'Keep bags on your lap in cafés; don\'t hang them on the back of chairs',
      'In an emergency you can shout "À l\'aide!" — everyone will respond',
    ],
  },

  Spain: {
    flag: '🇪🇸',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police (Policía Nacional)', number: '091' },
      { label: 'Local Police (Policía Local)', number: '092' },
      { label: 'Ambulance', number: '112' },
      { label: "Women's helpline", number: '016' },
    ],
    trustedTransport: [
      'Uber, Cabify, and FreeNow operate in Barcelona and Madrid; licensed taxis are metered',
      'Metro is safe and runs until 02:00 on weekdays, 05:00 on weekends in Barcelona',
    ],
    areasToAvoid: [
      'Las Ramblas (Barcelona) — tourist-dense and a pickpocket hotspot all hours',
      'El Raval after midnight, especially side streets',
      'Around Atocha Station (Madrid) late at night',
    ],
    commonScams: [
      'Shell game (three-card monte) street games — always rigged',
      'Distraction pickpockets on Las Ramblas — works in pairs',
      '"Friendship bracelets" tied on your wrist then payment demanded',
    ],
    phrases: [
      { en: 'Help', local: 'Ayuda / Socorro', pronunciation: 'a-yoo-da / so-ko-ro' },
      { en: 'Call the police', local: 'Llame a la policía', pronunciation: 'ya-meh a la poli-see-a' },
      { en: 'I need a doctor', local: 'Necesito un médico', pronunciation: 'ne-se-see-to un me-di-ko' },
      { en: 'Leave me alone', local: 'Déjame en paz', pronunciation: 'de-kha-meh en pas' },
    ],
    womenTips: [
      'Spain\'s 016 helpline for gender violence is free, 24/7, and leaves no trace on phone bills',
      'On crowded metro and buses, place your bag in front — pickpockets target tourists',
      'Beach areas in Barcelona have bag theft issues — never leave belongings unattended',
      'Harassment is illegal; shout "¡Esto es acoso!" (this is harassment) loudly',
    ],
  },

  Portugal: {
    flag: '🇵🇹',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police (PSP)', number: '112' },
      { label: 'Ambulance', number: '112' },
      { label: 'Fire', number: '112' },
      { label: "Women's helpline", number: '800 202 148' },
    ],
    trustedTransport: [
      'Uber, Bolt, and Cabify operate in Lisbon and Porto',
      'Historic trams (28, 15E) are notorious for pickpockets — keep bags zipped and in front',
    ],
    areasToAvoid: [
      'Martim Moniz area at night — can feel unsafe after midnight',
      'Intendente square late at night',
    ],
    commonScams: [
      'Tram 28 pickpockets — the most common tourist theft in Lisbon',
      'Overpriced "fado" dinner shows near Alfama — compare prices and reviews first',
      'ATM skimming — use ATMs inside bank branches',
    ],
    phrases: [
      { en: 'Help', local: 'Socorro / Ajuda', pronunciation: 'so-koh-roh / a-zhoo-da' },
      { en: 'Call the police', local: 'Chame a polícia', pronunciation: 'sha-meh a po-lee-see-a' },
      { en: 'I need a doctor', local: 'Preciso de um médico', pronunciation: 'pre-see-zoo deh oom me-di-koo' },
      { en: 'Leave me alone', local: 'Deixe-me em paz', pronunciation: 'day-sheh meh aym paz' },
    ],
    womenTips: [
      'Portugal is consistently ranked among the safest countries in Europe',
      'Lisbon hills (Alfama, Mouraria) are safe but poorly lit — carry a torch app',
      'The women\'s helpline (800 202 148) is free and confidential',
      'Beach towns like Cascais and Sintra are very safe for solo day trips',
    ],
  },

  Switzerland: {
    flag: '🇨🇭',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '117' },
      { label: 'Ambulance', number: '144' },
      { label: 'Fire', number: '118' },
      { label: "Women's helpline (Frauenhaus)", number: '0800 104 104' },
    ],
    trustedTransport: [
      'Uber operates in major cities; taxis are metered and strictly regulated',
      'Swiss rail is punctual and safe — the SBB app covers all national transport',
      'Mountain cable cars and trains are fully regulated — no safety concerns',
    ],
    areasToAvoid: [
      'Zurich Langstrasse at night — Zurich\'s red-light district, higher petty crime',
    ],
    commonScams: [
      'Fake charity collectors in city centres — Switzerland is very low-scam overall',
    ],
    phrases: [
      { en: 'Help', local: 'Hilfe / Au secours', pronunciation: 'hil-feh / oh se-koor' },
      { en: 'Call the police', local: 'Rufen Sie die Polizei', pronunciation: 'roo-fen zee dee poli-tsai' },
      { en: 'I need a doctor', local: 'Ich brauche einen Arzt', pronunciation: 'ikh brau-kheh eye-nen artst' },
      { en: 'Leave me alone', local: 'Lassen Sie mich in Ruhe', pronunciation: 'las-sen zee mikh in roo-eh' },
    ],
    womenTips: [
      'Switzerland is one of the safest countries in the world for solo women',
      'Mountain hiking: always tell someone your route and expected return time',
      'Download the Rega app (Swiss Air Rescue) before mountain excursions',
      'Emergency call 112 works from mountain areas even with poor signal',
    ],
  },

  Italy: {
    flag: '🇮🇹',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police (Polizia)', number: '113' },
      { label: 'Carabinieri', number: '112' },
      { label: 'Ambulance', number: '118' },
      { label: 'Fire', number: '115' },
      { label: "Women's helpline", number: '1522' },
    ],
    trustedTransport: [
      'Uber operates in Rome and Milan (UberBlack only — no UberX); licensed NCC taxis are metered',
      'Never take unlicensed "taxi" offers outside airports — always use white official taxis',
      'City buses and Metro are safe; avoid empty Metro cars late at night',
    ],
    areasToAvoid: [
      'Termini station area (Rome) after midnight — petty crime and hustlers',
      'Piazza Vittorio (Rome) late at night',
      'Central station areas in Naples after dark',
    ],
    commonScams: [
      'Airport taxi overcharging — Rome Fiumicino to centre is a fixed €50 rate',
      '"Gladiator" or "centurion" photo scams at the Colosseum',
      'Distraction theft near the Trevi Fountain and Vatican',
      'Fake friendship bracelets near tourist sites',
    ],
    phrases: [
      { en: 'Help', local: 'Aiuto', pronunciation: 'a-yoo-to' },
      { en: 'Call the police', local: 'Chiami la polizia', pronunciation: 'kee-a-mee la poli-tsee-a' },
      { en: 'I need a doctor', local: 'Ho bisogno di un medico', pronunciation: 'oh bee-zon-yo dee oon me-di-ko' },
      { en: 'Leave me alone', local: 'Lasciami in pace', pronunciation: 'la-sha-mee in pa-cheh' },
    ],
    womenTips: [
      'The 1522 national helpline for gender-based violence is free 24/7',
      'Street harassment exists but shouting "Basta!" (stop!) loudly is effective',
      'In Rome, keep bags on the side away from the road — moped bag snatches do occur',
      'Always validate your bus/Metro ticket — inspectors issue fines on the spot',
    ],
  },

  Austria: {
    flag: '🇦🇹',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '133' },
      { label: 'Ambulance', number: '144' },
      { label: 'Fire', number: '122' },
      { label: "Women's helpline", number: '0800 222 555' },
    ],
    trustedTransport: [
      'Uber and Bolt operate in Vienna; official taxis are metered',
      'Vienna U-Bahn runs 24h on weekends — very safe and reliable',
    ],
    areasToAvoid: [
      'Prater park after midnight — isolated paths can feel unsafe',
    ],
    commonScams: [
      'Fake charity petitions near St. Stephen\'s Cathedral',
      'Overpriced tourist menus on the Ringstrasse — walk one block back',
    ],
    phrases: [
      { en: 'Help', local: 'Hilfe', pronunciation: 'hil-feh' },
      { en: 'Call the police', local: 'Rufen Sie die Polizei', pronunciation: 'roo-fen zee dee poli-tsai' },
      { en: 'I need a doctor', local: 'Ich brauche einen Arzt', pronunciation: 'ikh brau-kheh eye-nen artst' },
      { en: 'Leave me alone', local: 'Lassen Sie mich in Ruhe', pronunciation: 'las-sen zee mikh in roo-eh' },
    ],
    womenTips: [
      'Vienna is consistently ranked the world\'s most liveable and safe city',
      'The women\'s helpline (0800 222 555) is free and available 24/7',
      'Night trams run in Vienna on weekends — check Wiener Linien app',
      'Cycling is excellent and safe throughout the city',
    ],
  },

  Greece: {
    flag: '🇬🇷',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '100' },
      { label: 'Ambulance', number: '166' },
      { label: 'Fire', number: '199' },
      { label: "Women's helpline", number: '15900' },
    ],
    trustedTransport: [
      'Bolt operates in Athens; official taxis are metered (yellow in Athens)',
      'Island ferries are safe; book through official operators like Blue Star or Aegean',
    ],
    areasToAvoid: [
      'Omonia Square (Athens) late at night — higher crime and drug activity',
      'Exarcheia neighbourhood after dark for solo women',
    ],
    commonScams: [
      'Taxi drivers not starting the meter — insist on the meter before moving',
      'Overpoured drinks at tourist bars charged at inflated prices',
      'Fake "closed" signs at attractions directing you to commission-paying shops',
    ],
    phrases: [
      { en: 'Help', local: 'Βοήθεια (Voítheia)', pronunciation: 'vo-ee-thee-a' },
      { en: 'Call the police', local: 'Φωνάξτε αστυνομία', pronunciation: 'fo-nax-teh as-ti-no-mee-a' },
      { en: 'I need a doctor', local: 'Χρειάζομαι γιατρό', pronunciation: 'khree-a-zo-meh ya-tro' },
      { en: 'Leave me alone', local: 'Αφήστε με ήσυχη', pronunciation: 'a-fees-teh meh ee-si-khee' },
    ],
    womenTips: [
      'Solo women travel is common in Greece; island hopping is generally very safe',
      'Street harassment exists in tourist areas — firm "Φύγε!" (fyeh = go away) works',
      'On beaches, leave valuables in your accommodation — don\'t leave bags unattended',
      'Ferries overnight: book a cabin for comfort and security on longer crossings',
    ],
  },

  'Czech Republic': {
    flag: '🇨🇿',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '158' },
      { label: 'Ambulance', number: '155' },
      { label: 'Fire', number: '150' },
      { label: "Women's helpline", number: '116 006' },
    ],
    trustedTransport: [
      'Uber and Bolt are widely used in Prague; avoid unlicensed taxis from the street',
      'Metro and trams run until midnight; night trams operate after that',
    ],
    areasToAvoid: [
      'Wenceslas Square late at night — tourist area with petty crime',
      'Around the main train station (Hlavní nádraží) after midnight',
    ],
    commonScams: [
      'Unlicensed taxis near Old Town Square — always use an app',
      'Currency exchange booths with zero commission but terrible rates',
      'Short-changing at cash transactions — count your change carefully',
    ],
    phrases: [
      { en: 'Help', local: 'Pomoc', pronunciation: 'po-mots' },
      { en: 'Call the police', local: 'Zavolejte policii', pronunciation: 'za-vo-lay-teh po-li-tsi-ee' },
      { en: 'I need a doctor', local: 'Potřebuji lékaře', pronunciation: 'pot-rzheh-boo-yi le-ka-rzheh' },
      { en: 'Leave me alone', local: 'Nechte mě na pokoji', pronunciation: 'nekh-teh myeh na po-ko-yi' },
    ],
    womenTips: [
      'Prague is very popular for solo female travel and generally very safe',
      'Avoid unlicensed taxis — Uber and Bolt are cheap and reliable',
      'Keep your drink in sight in bars on the tourist trail',
      'The 116 006 helpline for endangered women is free and 24/7',
    ],
  },

  Hungary: {
    flag: '🇭🇺',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '107' },
      { label: 'Ambulance', number: '104' },
      { label: 'Fire', number: '105' },
      { label: "Women's helpline", number: '06 80 505 101' },
    ],
    trustedTransport: [
      'Bolt is the recommended app in Budapest; avoid unlicensed taxis',
      'BKK (Budapest transit) is safe and covers the city well until 23:00',
    ],
    areasToAvoid: [
      'District VIII (Józsefváros) late at night — higher street crime',
      'Around Keleti railway station after midnight',
    ],
    commonScams: [
      'Ruin bar "pretty girl" scam — strangers invite you in then present huge bills',
      'Unlicensed taxis outside nightclubs — Bolt only',
      'Currency exchange with misleading "0% commission" signs near tourist sites',
    ],
    phrases: [
      { en: 'Help', local: 'Segítség', pronunciation: 'sheh-geet-shayg' },
      { en: 'Call the police', local: 'Hívja a rendőrséget', pronunciation: 'heev-ya a ren-der-shay-get' },
      { en: 'I need a doctor', local: 'Orvosra van szükségem', pronunciation: 'or-vosh-ra von sük-shay-gem' },
      { en: 'Leave me alone', local: 'Hagyjon békén', pronunciation: 'hodj-on bay-kayn' },
    ],
    womenTips: [
      'Budapest is very popular for solo travel; the Ruin Bar scene is vibrant but watch your drink',
      'Keep Bolt app ready — never accept unlicensed taxi offers near clubs',
      'Thermal baths are female-friendly with separate or mixed sessions clearly marked',
      'Trust the "women-only" carriages on some metro lines if uncomfortable',
    ],
  },

  Poland: {
    flag: '🇵🇱',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '997' },
      { label: 'Ambulance', number: '999' },
      { label: 'Fire', number: '998' },
      { label: "Women's helpline", number: '116 123' },
    ],
    trustedTransport: [
      'Uber and Bolt both operate reliably in Warsaw, Kraków, and other cities',
      'PKP trains are safe and comfortable for intercity travel',
    ],
    areasToAvoid: [
      'Praga district (Warsaw) late at night — improving but still caution advised',
    ],
    commonScams: [
      'Overpriced tourist restaurants near the main squares in Kraków and Warsaw',
      'Fake charity collectors in pedestrian zones',
    ],
    phrases: [
      { en: 'Help', local: 'Pomocy', pronunciation: 'po-mo-tsi' },
      { en: 'Call the police', local: 'Proszę zadzwonić na policję', pronunciation: 'pro-sheh za-dzvoh-neech na po-lits-yeh' },
      { en: 'I need a doctor', local: 'Potrzebuję lekarza', pronunciation: 'pot-rzheh-boo-yeh le-ka-zha' },
      { en: 'Leave me alone', local: 'Zostaw mnie w spokoju', pronunciation: 'zo-stav mnyeh v spo-ko-yoo' },
    ],
    womenTips: [
      'Poland is generally safe for solo female travellers; Kraków is especially welcoming',
      'Bolt is reliable and cheap — use it at night rather than street taxis',
      'Be cautious at large outdoor festivals; keep your group tight',
      'The 116 123 emotional support helpline is free and available around the clock',
    ],
  },

  Sweden: {
    flag: '🇸🇪',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police (non-emergency)', number: '114 14' },
      { label: 'Ambulance', number: '112' },
      { label: 'Fire', number: '112' },
      { label: "Women's helpline (Kvinnofridslinjen)", number: '020 50 50 50' },
    ],
    trustedTransport: [
      'Uber, Bolt, and Cabonline operate in Stockholm and major cities',
      'Stockholm Tunnelbana (metro) runs 24h on weekends — safe and reliable',
    ],
    areasToAvoid: [
      'Tensta and Rinkeby (Stockholm suburbs) at night — unfamiliar for tourists',
    ],
    commonScams: [
      'Overpriced tourist traps near Gamla Stan (Old Town) — walk a block to locals\' spots',
    ],
    phrases: [
      { en: 'Help', local: 'Hjälp', pronunciation: 'yelp' },
      { en: 'Call the police', local: 'Ring polisen', pronunciation: 'ring poh-lee-sen' },
      { en: 'I need a doctor', local: 'Jag behöver en läkare', pronunciation: 'yag be-her-ver en lay-ka-reh' },
      { en: 'Leave me alone', local: 'Lämna mig ifred', pronunciation: 'lem-na may ee-fred' },
    ],
    womenTips: [
      'Sweden has one of the world\'s highest gender equality rankings — solo travel is very normal',
      'The Kvinnofridslinjen (020 50 50 50) is a free 24/7 helpline for women in crisis',
      'Stockholm\'s islands require ferry transport — plan last services (usually ~midnight)',
      'Download the SL app for real-time Stockholm transit information',
    ],
  },

  Norway: {
    flag: '🇳🇴',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '112' },
      { label: 'Ambulance', number: '113' },
      { label: 'Fire', number: '110' },
      { label: "Women's helpline", number: '116 006' },
    ],
    trustedTransport: [
      'Uber operates in Oslo; licensed taxis are metered and reliable but expensive',
      'T-bane (Oslo Metro) is safe and runs late; check Ruter app for schedules',
    ],
    areasToAvoid: [
      'Oslo Central Station area late at night — petty crime can occur',
    ],
    commonScams: [
      'Very low scam risk in Norway; prices are high but legitimate',
    ],
    phrases: [
      { en: 'Help', local: 'Hjelp', pronunciation: 'yelp' },
      { en: 'Call the police', local: 'Ring politiet', pronunciation: 'ring poli-tee-et' },
      { en: 'I need a doctor', local: 'Jeg trenger lege', pronunciation: 'yai tren-ger lay-geh' },
      { en: 'Leave me alone', local: 'La meg være', pronunciation: 'la may vare-eh' },
    ],
    womenTips: [
      'Norway is extremely safe for solo women; one of the top-ranked countries globally',
      'Mountain hiking is popular — always register your route with Fjellvettreglene guidelines',
      'Download the Yr weather app before any outdoor activity — conditions change fast',
      'The 116 006 helpline for vulnerable persons is free 24/7',
    ],
  },
};

/* ── Lookup ───────────────────────────────────────────────────────────────── */

/**
 * Returns static country-level safety data if the country is in our library,
 * or null if we don't have it (caller should fall back to AI generation).
 */
export function staticSafetyForCountry(
  city: string,
  country: string,
): GeneratedSafety | null {
  const data = COUNTRIES[country];
  if (!data) return null;
  return {
    city,
    country,
    ...data,
    embassy: EMPTY_EMBASSY, // always AI-generated per nationality
    hospitals: [],           // always AI-generated per city
  };
}

/** List of countries covered by the static library. */
export const STATIC_SAFETY_COUNTRIES = Object.keys(COUNTRIES);
