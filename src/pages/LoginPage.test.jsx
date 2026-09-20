import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const mocks = vi.hoisted(() => ({
  authState: { current: null },
  refreshMembership: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("../auth/context", () => ({
  useAuth: () => mocks.authState.current,
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      signUp: mocks.signUp,
    },
  },
}));

function renderLogin(path = "/login") {
  return render(<MemoryRouter initialEntries={[path]}><LoginPage /></MemoryRouter>);
}

function completeRegistrationForm(email = "sales@example.com") {
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secure-pass-1" } });
  fireEvent.change(screen.getByLabelText("再次输入密码"), { target: { value: "secure-pass-1" } });
}

describe("LoginPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.authState.current = {
      loading: false,
      session: null,
      membership: null,
      user: null,
      error: null,
      requiresPasswordSetup: false,
      refreshMembership: mocks.refreshMembership,
    };
    mocks.refreshMembership.mockReset().mockResolvedValue(undefined);
    mocks.signInWithPassword.mockReset();
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
    mocks.signUp.mockReset();
  });

  it("switches between existing-account login and registration", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "登录 CRM" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
    expect(screen.getByRole("heading", { name: "注册 CRM 账号" })).toBeInTheDocument();
    expect(screen.getByLabelText("再次输入密码")).toBeInTheDocument();
    expect(screen.getByText("注册后仍需企业管理员使用同一邮箱把你加入企业。", { exact: false })).toBeInTheDocument();
  });

  it("signs in an existing account with a normalized email", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin();
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: " Sales@Example.COM " } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secure-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "sales@example.com",
      password: "secure-pass-1",
    }));
  });

  it("rejects mismatched registration passwords before calling Supabase", () => {
    renderLogin("/login?mode=register");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "sales@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secure-pass-1" } });
    fireEvent.change(screen.getByLabelText("再次输入密码"), { target: { value: "secure-pass-2" } });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("submits registration and explains email verification plus enterprise invitation", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null, user: { id: "new-user" } }, error: null });
    renderLogin("/login?mode=register");
    completeRegistrationForm();
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({
      email: "sales@example.com",
      password: "secure-pass-1",
      options: { emailRedirectTo: `${window.location.origin}/login?mode=login` },
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("注册申请已提交");
    expect(screen.getByRole("heading", { name: "登录 CRM" })).toBeInTheDocument();
  });

  it("blocks an authenticated account without membership and allows a permission refresh", async () => {
    mocks.authState.current = {
      ...mocks.authState.current,
      session: { user: { id: "new-user" } },
      user: { id: "new-user", email: "sales@example.com" },
    };
    renderLogin();
    expect(screen.getByRole("heading", { name: "等待加入企业" })).toBeInTheDocument();
    expect(screen.getByText("sales@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我已被邀请，重新检查" }));
    await waitFor(() => expect(mocks.refreshMembership).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("已经重新检查");
  });
});
