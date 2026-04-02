"""
apps/users/models.py  — User & API credentials
"""
import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Extended user with API quota tracking."""
    id        = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    api_quota = models.IntegerField(default=1000, help_text="Remaining daily API calls")
    tier      = models.CharField(
        max_length=16,
        choices=[("free","Free"),("pro","Pro"),("enterprise","Enterprise")],
        default="free"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "users"


class APICredential(models.Model):
    """Personal API keys for programmatic access."""
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name="credentials")
    name       = models.CharField(max_length=64)
    key_hash   = models.CharField(max_length=128, unique=True)
    is_active  = models.BooleanField(default=True)
    last_used  = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "api_credentials"
