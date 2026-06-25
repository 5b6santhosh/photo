# photo

* npm run dev  --> for automatic run your project

*npm i bootstrap      ---> this is for dependency

*npm i nodemon -D    ---> this is for dev dependency

*When you start a new project from scratch, you usually type this in your terminal to create a blank package.json:
npm init -y
----------------------------------------------------------
🔄 To Switch to S3 Later

Just change one line:
const USE_CLOUDINARY = false;

Or better — use an environment variable:
const USE_CLOUDINARY = process.env.STORAGE_PROVIDER !== 's3';

Then set:
STORAGE_PROVIDER=s3
----------------------------------------------------------


# Development Environment Configuration
NODE_ENV=development
PORT=6000
MONGO_URI=mongodb+srv://photoCurator:24101997@photocurator.7wecrld.mongodb.net/test?appName=PhotoCurator
BASE_URL=http://localhost:6000
ALLOWED_ORIGINS=http://localhost:6000,http://localhost:5173


# Production Environment Configuration
NODE_ENV=production
MONGO_URI=mongodb+srv://photoCurator:24101997@photocurator.7wecrld.mongodb.net/?appName=PhotoCurator
BASE_URL=https://photo-production-4173.up.railway.app
ALLOWED_ORIGINS=https://photo-production-4173.up.railway.app
