"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { motion } from "framer-motion";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  children: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className = "", children, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

    const variantStyles = {
      default:
        "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600",
      outline:
        "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700",
      ghost:
        "text-gray-700 hover:bg-gray-100 focus:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-800",
    };

    return (
      <motion.button
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${className}`}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
