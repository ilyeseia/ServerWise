import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";
import prisma from "@/generated/prisma/client";
import { auth } from "@/auth";
import { auditData } from "@/server/audit/tx";

describe("Report API", () => {
  beforeEach(async () => {
    // Setup test data
    await prisma.report.createMany({
      data: [
        {
          customerId: "c1",
          projectId: "p1",
          title: "Test Report 1",
          amount: 1000,
          status: "completed",
          createdAt: new Date("2024-01-15"),
        },
        {
          customerId: "c2",
          projectId: "p2",
          title: "Test Report 2",
          amount: 2500,
          status: "pending",
          createdAt: new Date("2024-02-20"),
        },
      ],
    });
  });

  afterEach(async () => {
    await prisma.report.deleteMany({});
  });

  describe("GET /api/reports", () => {
    it("should return unauthorized if not logged in", async () => {
      const response = await fetch(
        "http://localhost:3000/api/reports",
        { method: "GET" },
      );
      expect(response.status).toBe(401);
    });

    it("should return reports summary", async () => {
      // Mock session
      const mockSession = {
        user: { id: "user1", name: "Test User", role: "owner" },
      };

      const originalSession = globalThis.sessionStorage;
      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify(mockSession),
        configurable: true,
      });

      const response = await fetch(
        "http://localhost:3000/api/reports?type=summary&format=html",
        { method: "GET" },
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Report Summary");
      expect(text).toContain("Test Report 1");
      expect(text).toContain("Test Report 2");

      // Restore session
      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify({}),
        configurable: true,
      });
    });

    it("should generate PDF format", async () => {
      const mockSession = {
        user: { id: "user1", name: "Test User", role: "owner" },
      };

      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify(mockSession),
        configurable: true,
      });

      const response = await fetch(
        "http://localhost:3000/api/reports?type=summary&format=pdf",
        { method: "GET" },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toContain(
        "report-2024-01-15.pdf",
      );
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      const text = await response.text();
      expect(text).toContain("إجمالي الإيرادات");
      expect(text).toContain("Test Report 1");

      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify({}),
        configurable: true,
      });
    });

    it("should generate CSV format", async () => {
      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify(mockSession),
        configurable: true,
      });

      const response = await fetch(
        "http://localhost:3000/api/reports?type=summary&format=csv",
        { method: "GET" },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toContain(
        "report-2024-01-15.csv",
      );
      expect(response.headers.get("Content-Type")).toBe("text/csv");
      const text = await response.text();
      expect(text).toContain("date,customer,service,amount,status");
      expect(text).toContain("Test Report 1");

      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify({}),
        configurable: true,
      });
    });

    it("should generate Excel (HTML) format", async () => {
      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify(mockSession),
        configurable: true,
      });

      const response = await fetch(
        "http://localhost:3000/api/reports?type=summary&format=excel",
        { method: "GET" },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toContain(
        "report-2024-01-15.xls",
      );
      expect(response.headers.get("Content-Type")).toBe(
        "application/vnd.ms-excel",
      );
      const text = await response.text();
      expect(text).toContain("<table>");
      expect(text).toContain("Test Report 1");

      Object.defineProperty(globalThis, "sessionStorage", {
        value: JSON.stringify({}),
        configurable: true,
      });
    });
  });
});