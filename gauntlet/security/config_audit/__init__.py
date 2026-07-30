"""Offline audit of repository-owned agent configuration and skill metadata."""

from .audit import audit_agent_configuration

__all__ = ["audit_agent_configuration"]
