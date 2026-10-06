import { Request, Response } from "express";
import { pool } from "../db";
import bcrypt from "bcrypt";
import { clearAuthCookie, setAuthCookie } from "../lib/auth";

export async function Register(req: Request, res: Response) {
    console.log("\n End Point Hit : ", req.url)
    console.log("Body : ", req.body)
  const { name, email, password, hourly_rate, max_capacity_hours } = req.body ?? {};
  try {
    if (!name || !email || !password || !hourly_rate || !max_capacity_hours) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const hashPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, hourly_rate, max_capacity_hours)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email`,
      [name, email, hashPassword, hourly_rate, max_capacity_hours]
    );
    const user = result.rows[0];
    setAuthCookie(res, { id: Number(user.id), email: user.email });

    return res.status(201).json({
      message: "User created successfully",
      user: { id: Number(user.id), name: user.name, email: user.email },
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ message: "Email is already registered" });
    }
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function Login(req: Request, res: Response) {
  console.log("\n End Point Hit : ", req.url)
  const { email, password } = req.body ?? {};
  try {
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const result = await pool.query(
      `SELECT id, name, email, password
       FROM users
       WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    setAuthCookie(res, { id: Number(user.id), email: user.email });
    return res.json({ id: Number(user.id), name: user.name, email: user.email });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function Logout(req: Request, res: Response) {
  console.log("\n End Point Hit : ", req.url)
  clearAuthCookie(res);
  return res.status(200).json({ message: "Logged out successfully" });
}

export async function Me(req: Request, res: Response) {
  return res.json({ id: req.user?.id, email: req.user?.email });
}
