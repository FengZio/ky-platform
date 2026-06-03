import sys  
sys.path.insert(0, '.')  
from src.services.supabase import get_admin  
client = get_admin()  
print('supabase ok') 
