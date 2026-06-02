/* ==========================================================================
   On the Road · Solo-female travel essentials (static, trip-wide)
   Non-AI, not stored. Calm and empowering in tone — "you've got this",
   not "the world is dangerous".
   ========================================================================== */

export interface EssentialGroup {
  icon: string;
  title: string;
  items: string[];
}

export const ESSENTIALS: EssentialGroup[] = [
  {
    icon: '🚪',
    title: 'Accommodation check-in',
    items: [
      'Ask for a room not on the ground floor and away from stairwells',
      "Don't say your room number out loud at the desk — have them write it",
      'Locate the fire exits and stairs the moment you arrive',
      'Use the deadbolt + a portable door stop / door alarm at night',
      'Keep curtains closed after dark; valuables in the safe or out of sight',
    ],
  },
  {
    icon: '🧭',
    title: 'Out and about',
    items: [
      'Walk with purpose and look like you know where you are going',
      'If you feel followed, step into a café, shop or hotel lobby',
      'Keep your bag cross-body and zipped, on the wall side of the pavement',
      'Screenshot your route offline in case you lose signal',
      'Have the address of your stay written in the local language',
    ],
  },
  {
    icon: '🍸',
    title: 'Bars & nightlife',
    items: [
      'Watch your drink being poured; never leave it unattended',
      'Cover your glass; if it tastes odd, stop drinking it',
      'Set up a meet-up app code-word with a friend back home',
      'Pre-book a licensed ride home before you head out',
      'Trust the "Angel Shot" / Ask for Angela signals where they exist',
    ],
  },
  {
    icon: '📱',
    title: 'Digital safety',
    items: [
      'Post locations after you leave them, not in real time',
      'Back up passport, visa and insurance to the cloud + a printed copy',
      'Share your live location with one trusted contact',
      'Use a VPN on public Wi-Fi; avoid banking on open networks',
      'Keep a charged power bank — a dead phone is a real risk',
    ],
  },
  {
    icon: '🤝',
    title: 'Blending in & boundaries',
    items: [
      'Dress with an eye to local norms — it lowers unwanted attention',
      'Learn "no", "help" and "leave me alone" in the local language',
      'A firm, loud "No!" is a complete sentence — make a scene if needed',
      'Wear a (decoy) ring if it deflects unwanted advances',
      'It is always okay to lie about meeting a husband / friend nearby',
    ],
  },
];
