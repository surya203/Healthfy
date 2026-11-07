export type User = {
  id: string;
  name: string;
  email: string;
  created_at: string;
};

export type RegisterBody = {
  name: string;
  email: string;
  password: string;
};

export type LoginBody = {
  email: string;
  password: string;
};

export type RequestOptions = {
  signal?: AbortSignal;
};

export type FieldIssue = {
  field: string;
  message: string;
};

export type ErrorDetails = {
  fields: FieldIssue[];
};

/** Cookie session client. Implementations must not touch browser storage. */
export type AuthClient = {
  register(input: RegisterBody, options?: RequestOptions): Promise<User>;
  login(input: LoginBody, options?: RequestOptions): Promise<User>;
  me(options?: RequestOptions): Promise<User>;
  logout(options?: RequestOptions): Promise<void>;
};
