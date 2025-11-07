-- Migration: Create tables for MCP Image Generator
-- Created: 2025-11-07
-- Purpose: Job tracking and generation history

-- Table 1: generation_jobs
-- Tracks all image generation jobs with status
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  prompt TEXT NOT NULL,
  model TEXT NOT NULL CHECK(model IN ('flux-schnell', 'sdxl-lightning', 'sdxl-base')),
  image_url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for status queries (list jobs by status)
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);

-- Index for date queries (list recent jobs)
CREATE INDEX idx_generation_jobs_created ON generation_jobs(created_at DESC);

-- Table 2: generations
-- Historical archive of completed generations for fast queries
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
);

-- Index for date queries (list_generations sorted by recency)
CREATE INDEX idx_generations_created ON generations(created_at DESC);

-- Index for job_id lookups
CREATE INDEX idx_generations_job_id ON generations(job_id);
