# Modern POS System

A futuristic, high-tech Point of Sale (POS) system built with React, Vite, Tailwind CSS, and Supabase.

## Features

- 🚀 **Modern UI/UX**: Glassmorphism design, neon accents, and smooth animations.
- 🛒 **POS Terminal**: Fast product search, barcode scanning support, and cart management.
- 📦 **Inventory Management**: Track stock levels, low stock alerts, and product categories.
- 📊 **Analytics**: Sales reporting and insights.
- ☁️ **Cloud Database**: Real-time data persistence using Supabase.
- 📱 **Responsive**: Works on desktop and tablet devices.

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Styling**: Tailwind CSS, shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **Icons**: Lucide React

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A Supabase account (free tier is sufficient)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd POS_System
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup (Supabase)

1.  **Create a Project**: Go to [supabase.com](https://supabase.com), sign up/login, and create a new project.
2.  **Run SQL Script**:
    *   In your Supabase project dashboard, go to the **SQL Editor** (icon on the left sidebar).
    *   Click **New Query**.
    *   Open the file `SUPABASE_SETUP.sql` located in the root of this project.
    *   Copy the entire content of `SUPABASE_SETUP.sql` and paste it into the Supabase SQL Editor.
    *   Click **Run** to create the necessary tables and security policies.

### 4. Environment Configuration

1.  Create a `.env` file in the root directory (you can copy `.env.example`).
    ```bash
    cp .env.example .env
    ```
2.  Get your Supabase credentials:
    *   In your Supabase project dashboard, go to **Project Settings** (gear icon) -> **API**.
    *   Copy the **Project URL**.
    *   Copy the **anon** / **public** key.
3.  Update your `.env` file:
    ```env
    VITE_SUPABASE_URL=your_project_url_here
    VITE_SUPABASE_ANON_KEY=your_anon_key_here
    ```

## Running the Application

Start the development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:8080` (or the port shown in your terminal).

## Building for Production

To create a production build:

```bash
npm run build
```

The built files will be in the `dist` directory.

## Default Login

Since this is a demo/template, the authentication is currently mocked or simplified.
- **Admin Mode**: Access full features (Inventory, Settings).
- **Cashier Mode**: Restricted to POS Terminal and My Sales.

*(Note: If you implement full Supabase Auth, you will need to update the AuthContext to use Supabase's auth methods.)*
# super-mart-system
