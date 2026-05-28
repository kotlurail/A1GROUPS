/**
 * Central API service — all fetch calls go through here.
 * Change BASE_URL to your server address:
 *   • Local dev on same machine : http://localhost:5000
 *   • Android emulator          : http://10.0.2.2:5000
 *   • Physical device / Expo Go : http://<your-local-IP>:5000
 *   • Production                : https://api.yourdomain.com
 */
import { Platform } from 'react-native';
import { getToken } from './auth';

const _configuredUrl = (globalThis as any).process?.env?.EXPO_PUBLIC_API_URL ?? 'https://a1groups.onrender.com';

// Android emulator cannot reach host's localhost — remap automatically
export const BASE_URL =
  Platform.OS === 'android'
    ? _configuredUrl.replace('localhost', '10.0.2.2')
    : _configuredUrl;

// ─── Generic helpers ───────────────────────────────────────────────────────────

const TIMEOUT_MS = 65_000;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers ?? {}),
      },
      ...options,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT');
    }
    throw err;
  }
}

const get    = <T>(path: string)                  => request<T>(path);
const post   = <T>(path: string, body: unknown)   => request<T>(path, { method: 'POST',   body: JSON.stringify(body) });
const put    = <T>(path: string, body: unknown)   => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) });
const patch  = <T>(path: string, body: unknown)   => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) });
const del    = <T>(path: string)                  => request<T>(path, { method: 'DELETE' });

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  login:  (pin: string) => post<{ token: string }>('/api/auth/login', { pin }),
  logout: ()            => post<{ ok: boolean }>('/api/auth/logout', {}),
  ping:   ()            => get<{ status: string }>('/'),
};

// ─── Types (mirror backend models) ────────────────────────────────────────────

export interface Transaction {
  _id:           string;
  type:          'income' | 'expense';
  amount:        number;
  category:      string;
  venue:         string;
  date:          string;
  paymentMethod: string;
  comments:      string;
  status:        'completed' | 'pending' | 'cancelled';
  createdAt:     string;
}

export interface TransactionStats {
  summary:  { _id: string; total: number; count: number }[];
  byVenue:  { _id: { venue: string; type: string }; total: number }[];
  monthly:  { _id: { month: string; type: string }; total: number }[];
}

export interface InventoryItem {
  _id:           string;
  name:          string;
  category:      string;
  venue:         string;
  totalQty:      number;
  rentalPrice:   number;
  purchasePrice: number;
  notes:         string;
  // added by /availability endpoint:
  inUse?:        number;
  available?:    number;
}

export interface RentalItemPayload {
  _id?:         string;
  itemId:       string;
  itemName:     string;
  venue:        string;
  qtyGiven:     number;
  pricePerItem: number;
  returnStatus: 'pending' | 'partial' | 'returned';
  qtyReturned:  number;
  returnCond:   'Good' | 'Fair' | 'Damaged';
  damageNotes:  string;
  penalty:      number;
  returnDate:   string;
}

export interface RentalEntry {
  _id:           string;
  customerName:  string;
  mobile:        string;
  eventName:     string;
  eventType:     string;
  eventDate:     string;
  venueLocation: string;
  returnDate:    string;
  comments:      string;
  items:         RentalItemPayload[];
  createdAt:     string;
}

export interface DecorItemPayload  { _id?: string; name: string; qty: number; unitCost: number; comment: string; }
export interface DecorSectionPayload {
  _id?:     string;
  heading:  string;
  images:   string[];
  taxPct:   number;
  discount: number;
  items:    DecorItemPayload[];
  comment:  string;
}
export interface EventEstimate {
  _id:          string;
  eventName:    string;
  customerName: string;
  mobile:       string;
  eventDate:    string;
  location:     string;
  eventType:    string;
  advance:      number;
  quotedAmount: number;
  decors:       DecorSectionPayload[];
  createdAt:    string;
}

export interface EventStats {
  total:          number;
  totalRevenue:   number;
  totalAdvance:   number;
  balancePending: number;
  byType:         Record<string, number>;
}

// ─── Transactions API ──────────────────────────────────────────────────────────

export const transactionsApi = {
  getAll: (params?: {
    type?: string; venue?: string; status?: string; from?: string; to?: string;
  }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return get<Transaction[]>(`/api/transactions${q ? '?' + q : ''}`);
  },
  getStats: () => get<TransactionStats>('/api/transactions/stats'),
  create:   (body: Omit<Transaction, '_id' | 'createdAt'>) => post<Transaction>('/api/transactions', body),
  update:   (id: string, body: Partial<Transaction>)       => put<Transaction>(`/api/transactions/${id}`, body),
  remove:   (id: string)                                   => del<{ message: string }>(`/api/transactions/${id}`),
};

// ─── Inventory API ─────────────────────────────────────────────────────────────

export const inventoryApi = {
  getAll:        (params?: { venue?: string; category?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return get<InventoryItem[]>(`/api/inventory${q ? '?' + q : ''}`);
  },
  getAvailability: () => get<InventoryItem[]>('/api/inventory/availability'),
  create:          (body: Omit<InventoryItem, '_id'>)          => post<InventoryItem>('/api/inventory', body),
  update:          (id: string, body: Partial<InventoryItem>)  => put<InventoryItem>(`/api/inventory/${id}`, body),
  remove:          (id: string)                                => del<{ message: string }>(`/api/inventory/${id}`),
};

// ─── Rentals API ───────────────────────────────────────────────────────────────

export const rentalsApi = {
  getAll: (params?: { returnStatus?: string; venue?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return get<RentalEntry[]>(`/api/rentals${q ? '?' + q : ''}`);
  },
  create:      (body: Omit<RentalEntry, '_id' | 'createdAt'>)     => post<RentalEntry>('/api/rentals', body),
  update:      (id: string, body: Partial<RentalEntry>)           => put<RentalEntry>(`/api/rentals/${id}`, body),
  returnItem:  (rentalId: string, itemId: string, body: Partial<RentalItemPayload>) =>
    patch<RentalEntry>(`/api/rentals/${rentalId}/items/${itemId}/return`, body),
  remove:      (id: string) => del<{ message: string }>(`/api/rentals/${id}`),
};

// ─── Events API ────────────────────────────────────────────────────────────────

export const eventsApi = {
  getAll: (params?: { eventType?: string; search?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return get<EventEstimate[]>(`/api/events${q ? '?' + q : ''}`);
  },
  getStats: () => get<EventStats>('/api/events/stats'),
  create:   (body: Omit<EventEstimate, '_id' | 'createdAt'>)  => post<EventEstimate>('/api/events', body),
  update:   (id: string, body: Partial<EventEstimate>)        => put<EventEstimate>(`/api/events/${id}`, body),
  remove:   (id: string)                                      => del<{ message: string }>(`/api/events/${id}`),
};

// ─── Employees API ─────────────────────────────────────────────────────────────

export interface AttendanceRecord {
  date:   string;
  status: 'present' | 'absent' | 'half' | 'holiday';
}

export interface CashEntry {
  _id:    string;
  date:   string;
  amount: number;
  note:   string;
  type:   'advance' | 'salary' | 'deduction';
}

export interface EmployeeDoc {
  _id:           string;
  name:          string;
  role:          string;
  phone:         string;
  monthlySalary: number;
  workingDays:   number;
  joinDate:      string;
  periodStart:   string;
  periodEnd:     string;
  attendance:    AttendanceRecord[];
  cashEntries:   CashEntry[];
  createdAt:     string;
}

export const employeesApi = {
  getAll: () => get<EmployeeDoc[]>('/api/employees'),
  create: (body: Omit<EmployeeDoc, '_id' | 'createdAt'>) => post<EmployeeDoc>('/api/employees', body),
  update: (id: string, body: Partial<EmployeeDoc>)        => put<EmployeeDoc>(`/api/employees/${id}`, body),
  patchAttendance: (id: string, date: string, status: string | null) =>
    patch<EmployeeDoc>(`/api/employees/${id}/attendance`, { date, status }),
  addCash:    (id: string, body: Omit<CashEntry, '_id'>) => post<EmployeeDoc>(`/api/employees/${id}/cash`, body),
  removeCash: (id: string, cashId: string)               => del<EmployeeDoc>(`/api/employees/${id}/cash/${cashId}`),
  remove:     (id: string)                               => del<{ message: string }>(`/api/employees/${id}`),
};

// ─── Bookings API ──────────────────────────────────────────────────────────────

export interface PaymentDoc {
  _id?: string;
  amount: number;
  mode: string;
  date: string;
  time: string;
  note?: string;
}

export interface ExpenseDoc {
  _id?: string;
  title: string;
  amount: number;
}

export interface ExtraBenefitDoc {
  _id?: string;
  name: string;
  amount: number;
}

export interface BookingDoc {
  _id: string;
  venue: string;
  date: string;
  slot: 'morning' | 'evening';
  eventName: string;
  guestCount: number;
  amount: number;
  payments: PaymentDoc[];
  status: 'confirmed' | 'pending' | 'cancelled' | 'paid';
  client: string;
  phone: string;
  startReading?: number | null;
  endReading?: number | null;
  acHours?: number | null;
  decorCost?: number | null;
  extraBenefits: ExtraBenefitDoc[];
  expenses: ExpenseDoc[];
  discount?: number | null;
  comments: string;
  createdAt: string;
}

export const bookingsApi = {
  getAll: (params?: { venue?: string; status?: string; date?: string; month?: string }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null)) as Record<string, string>
    ).toString();
    return get<BookingDoc[]>(`/api/bookings${q ? '?' + q : ''}`);
  },
  create: (body: Omit<BookingDoc, '_id' | 'createdAt'>) => post<BookingDoc>('/api/bookings', body),
  update: (id: string, body: Partial<Omit<BookingDoc, '_id' | 'createdAt'>>) => put<BookingDoc>(`/api/bookings/${id}`, body),
  remove: (id: string) => del<{ message: string }>(`/api/bookings/${id}`),
};

// ─── Decor Master Items API ───────────────────────────────────────────────────

export interface DecorMasterItem {
  _id: string;
  name: string;
}

export const decorItemsApi = {
  getAll: ()                  => get<DecorMasterItem[]>('/api/decor-items'),
  create: (name: string)      => post<DecorMasterItem>('/api/decor-items', { name }),
  remove: (id: string)        => del<{ message: string }>(`/api/decor-items/${id}`),
};

// ─── Decors API ────────────────────────────────────────────────────────────────

export interface DecorItemDoc {
  _id?: string;
  name: string;
  quantity: number;
  costPerUnit: number;
}

export interface RequiredItemDoc {
  _id?: string;
  name: string;
  quantity: number;
  description: string;
}

export interface DecorDoc {
  _id: string;
  eventName: string;
  eventType: string;
  customerName: string;
  mobile: string;
  eventDate: string;
  location: string;
  images: string[];
  decorItems: DecorItemDoc[];
  requiredItems: RequiredItemDoc[];
  advanceAmount: number;
  settledAmount: number;
  quotedAmount: number;
  paymentStatus: 'pending' | 'partial' | 'completed';
  comments: string;
  createdDate: string;
  bookingId?: string | null;
  createdAt: string;
}

export const decorsApi = {
  getAll: (params?: { eventType?: string; status?: string; search?: string; bookingId?: string }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null && v !== '')) as Record<string, string>
    ).toString();
    return get<DecorDoc[]>(`/api/decors${q ? '?' + q : ''}`);
  },
  create: (body: Omit<DecorDoc, '_id' | 'createdAt'>) => post<DecorDoc>('/api/decors', body),
  update: (id: string, body: Partial<Omit<DecorDoc, '_id' | 'createdAt'>>) => put<DecorDoc>(`/api/decors/${id}`, body),
  remove: (id: string) => del<{ message: string }>(`/api/decors/${id}`),
};

// ─── Accounts Feed API ────────────────────────────────────────────────────────

export interface FeedItem {
  id:            string;
  source:        'Bookings' | 'Decors' | 'Employees' | 'Rentals' | 'Manual';
  type:          'income' | 'expense';
  amount:        number;
  category:      string;
  reference:     string;
  venue:         string;
  date:          string;
  paymentMethod: string;
  status:        'completed' | 'pending' | 'cancelled';
  note:          string;
}

export const accountsApi = {
  getFeed: (params?: { from?: string; to?: string; type?: string; source?: string }) => {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null && v !== '')) as Record<string, string>
    ).toString();
    return get<FeedItem[]>(`/api/accounts/feed${q ? '?' + q : ''}`);
  },
};

// ─── Image Upload API ──────────────────────────────────────────────────────────

function mimeFromExt(ext: string): string {
  switch (ext) {
    case 'png':  return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif':  return 'image/gif';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    default:     return 'image/jpeg';
  }
}

export const uploadApi = {
  /** Upload a local file URI → returns Cloudinary URL */
  uploadImage: async (localUri: string): Promise<string> => {
    const form = new FormData();
    const filename = localUri.split('/').pop() ?? 'photo.jpg';
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime = mimeFromExt(ext);

    if (Platform.OS === 'web') {
      // On web, fetch the URI as a Blob and append it — { uri, name, type } only works in React Native
      const blobRes = await fetch(localUri);
      const blob = await blobRes.blob();
      form.append('image', blob, filename);
    } else {
      // React Native FormData accepts { uri, name, type } objects
      form.append('image', { uri: localUri, name: filename, type: mime } as any);
    }

    const token = await getToken();
    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data.url as string;
  },

  /** Delete a Cloudinary asset by publicId */
  deleteImage: (publicId: string) =>
    del<{ message: string }>(`/api/upload?publicId=${encodeURIComponent(publicId)}`),
};
