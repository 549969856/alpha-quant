from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import generics


class RegisterView(generics.CreateAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        username = request.data.get("username")
        password = request.data.get("password")
        if not username or not password:
            return Response({"error": "username and password required"}, status=400)
        if User.objects.filter(username=username).exists():
            return Response({"error": "username already taken"}, status=400)
        user = User.objects.create_user(username=username, password=password)
        return Response({"id": str(user.id), "username": user.username}, status=201)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        u = request.user
        return Response({
            "id":       str(u.id),
            "username": u.username,
            "email":    u.email,
            "tier":     getattr(u, "tier", "free"),
        })
