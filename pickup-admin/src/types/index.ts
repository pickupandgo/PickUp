// ============================================================
// PICK UP ADMIN PANEL — CORE TYPE DEFINITIONS
// ============================================================

// --- Admin User ---
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'supervisor';
  avatar?: string;
}

// --- Auth State ---
export interface AuthState {
  isAuthenticated: boolean;
  user: AdminUser | null;
  isLoading: boolean;
  error: string | null;
}

// --- Login Credentials ---
export interface LoginCredentials {
  email: string;
  password: string;
}

// --- Login Response ---
export interface LoginResponse {
  success: boolean;
  user?: AdminUser;
  token?: string;
  error?: string;
}

// --- Navigation Item ---
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  disabled?: boolean;
  badge?: string | number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

// --- Toast ---
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

// --- Modal ---
export interface ModalState {
  isOpen: boolean;
  title?: string;
  content?: React.ReactNode;
}

// --- Confirmation Dialog ---
export interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm?: () => void;
  onCancel?: () => void;
}

// --- Pagination ---
export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

// --- API Response Shape (for future integration) ---
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  pagination?: PaginationState;
}

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

// --- Generic list state ---
export interface ListState<T> {
  items: T[];
  isLoading: boolean;
  error: string | null;
  pagination: PaginationState;
}
