// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

import ClientIdentityMenu, { type PersonInfo } from "../client-identity-menu";

const couple: PersonInfo[] = [
  {
    role: "primary",
    firstName: "Cooper",
    lastName: "Sample",
    dateOfBirth: "1971-03-12",
    email: "cooper@example.com",
    phone: null,
    mobile: "(555) 111-2222",
  },
  {
    role: "spouse",
    firstName: "Susan",
    lastName: "Sample",
    dateOfBirth: "1975-08-04",
    email: "susan@example.com",
    phone: null,
    mobile: null,
  },
];

describe("ClientIdentityMenu", () => {
  it("renders the household title and ages, closed by default", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    expect(screen.getByText("Cooper & Susan Sample")).toBeInTheDocument();
    expect(screen.getByText(/Ages \d+ & \d+/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the details dialog on click with primary contact info", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    fireEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("cooper@example.com");
    expect(dialog).toHaveTextContent("(555) 111-2222");
    expect(dialog).toHaveTextContent(/Age \d+/);
  });

  it("shows a spouse block with the spouse's details", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog")).toHaveTextContent("susan@example.com");
  });

  it("omits rows for missing fields", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    fireEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Mobile");
    expect(dialog).not.toHaveTextContent("Phone"); // neither person has a phone
  });

  it("links to the client's details page", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    fireEvent.click(screen.getByRole("button"));
    const link = screen.getByRole("link", { name: /view full profile/i });
    expect(link).toHaveAttribute("href", "/clients/abc/details");
  });

  it("links to the client's activity log", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    fireEvent.click(screen.getByRole("button"));
    const link = screen.getByRole("link", { name: /activity log/i });
    expect(link).toHaveAttribute("href", "/clients/abc/activity");
  });

  it("closes on Escape", () => {
    render(<ClientIdentityMenu clientId="abc" people={couple} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a single-person household with no spouse block", () => {
    const single: PersonInfo[] = [couple[0]];
    render(<ClientIdentityMenu clientId="abc" people={single} />);
    expect(screen.getByText("Cooper Sample")).toBeInTheDocument();
    expect(screen.getByText(/^· Age \d+$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Susan");
  });
});
