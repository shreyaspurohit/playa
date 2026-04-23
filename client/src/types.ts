// Shape of the JSON embedded by the Python builder. Kept in sync with
// bm_camps/models.py (Camp.to_dict / Event.to_dict).
export interface Event {
  id: string;
  name: string;
  description: string;
  time: string;          // raw directory text
  display_time: string;  // pre-parsed clean form; may be "" if unparseable
}

export interface Camp {
  id: string;
  name: string;
  location: string;
  description: string;
  website: string;
  url: string;           // canonical /camps/<id>/
  tags: string[];
  events: Event[];
}

export interface EncryptedPayload {
  salt: string;          // base64
  iter: number;          // PBKDF2 iterations
  ct: string;            // base64 ciphertext
}

// LocalStorage keys — declared here so any refactor touches one place.
export const LS = {
  theme:     'bm-theme',
  infoSeen:  'bm-info-seen',
  favs:      'bm-favs',
  favEvents: 'bm-fav-events',
} as const;

export const SS = {
  password:  'bm-pw',
} as const;
