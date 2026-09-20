import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetPasswordPage } from "./SetPasswordPage";

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  completePasswordSetup: vi.fn(),
}));

vi.mock("../auth/context", () => ({
  useAuth: () => ({
    loading: false,
    session: { user: { id: "owner-user" } },
    user: { user_metadata: { display_name: "Owner", requires_password_setup: true } },
    requiresPasswordSetup: true,
    completePasswordSetup: mocks.completePasswordSetup,
  }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { updateUser: mocks.updateUser } },
}));

describe("SetPasswordPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.updateUser.mockReset();
    mocks.completePasswordSetup.mockReset();
  });

  it("rejects mismatched passwords without calling Supabase", () => {
    render(<MemoryRouter><SetPasswordPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "secure-pass-1" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "secure-pass-2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存密码并进入 CRM" }));
    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("sets the password and clears the setup marker", async () => {
    mocks.updateUser.mockResolvedValue({ error: null });
    render(<MemoryRouter><SetPasswordPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "secure-pass-1" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "secure-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存密码并进入 CRM" }));
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "secure-pass-1",
      data: { display_name: "Owner", requires_password_setup: false },
    }));
    expect(mocks.completePasswordSetup).toHaveBeenCalledOnce();
  });
});
